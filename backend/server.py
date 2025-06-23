
from fastapi import FastAPI, HTTPException, Depends, status, BackgroundTasks
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient
from pydantic import BaseModel, EmailStr
from passlib.context import CryptContext
from datetime import datetime, timedelta
import jwt
import os
import uuid
import requests
import hashlib
import hmac
from typing import Optional, List
import asyncio
import logging
from contextlib import asynccontextmanager

# Environment variables
MONGO_URL = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "profitpilot")

# Secrets
JWT_SECRET = os.getenv("JWT_SECRET", "SuperSecretKey123")
PAYSTACK_SECRET_KEY = os.getenv(
    "PAYSTACK_SECRET_KEY",
    "sk_live_b41107e30aa0682bdfbf68a60dbc3b49da6da6fa"
)
PAYSTACK_PUBLIC_KEY = os.getenv(
    "PAYSTACK_PUBLIC_KEY",
    "pk_live_561c88fdbc97f356950fc7d9881101e4cb074707"
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Global mining task variable
mining_task = None

# MongoDB connection
try:
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]

    # Collections
    users_collection = db.users
    tokens_collection = db.tokens
    transactions_collection = db.transactions
    referrals_collection = db.referrals
    mining_logs_collection = db.mining_logs
    tasks_collection = db.tasks
    notifications_collection = db.notifications
    broadcasts_collection = db.broadcasts

    logger.info(f"✅ Connected to MongoDB at: {MONGO_URL}")
except Exception as e:
    logger.error(f"❌ MongoDB connection failed: {e}")

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# JWT security
security = HTTPBearer()

# Pydantic models
class UserRegister(BaseModel):
    email: EmailStr
    password: str
    referral_code: Optional[str] = None

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class TokenCreate(BaseModel):
    name: str

class BoostToken(BaseModel):
    token_id: str

class PaymentVerification(BaseModel):
    reference: str
    token_id: Optional[str] = None
    action: str  # "boost" or "token"

# New Admin Models
class AdminSendBalance(BaseModel):
    user_id: str
    amount: float
    reason: str

class AdminCreateTask(BaseModel):
    title: str
    description: str
    reward: float
    type: str  # "daily", "one_time", "repeatable"
    requirements: Optional[str] = None
    expires_at: Optional[datetime] = None

class AdminGiveBoost(BaseModel):
    user_id: str
    token_id: str
    boost_levels: int
    reason: str

class AdminBroadcast(BaseModel):
    title: str
    message: str
    type: str  # "info", "warning", "success", "error"
    priority: str  # "low", "medium", "high"

class TaskComplete(BaseModel):
    task_id: str

# Helper functions
def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(hours=24)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm="HS256")
    return encoded_jwt

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=["HS256"])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        user = users_collection.find_one({"user_id": user_id})
        if user is None:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

def generate_referral_code(email: str) -> str:
    return f"PP{hashlib.md5(email.encode()).hexdigest()[:8].upper()}"

def generate_user_id() -> str:
    return f"PP-{str(uuid.uuid4()).split('-')[0].upper()}"

async def get_usd_to_ngn_rate():
    """Get USD to NGN conversion rate from free API"""
    try:
        response = requests.get("https://api.exchangerate-api.com/v4/latest/USD", timeout=5)
        data = response.json()
        return data['rates']['NGN']
    except:
        return 1500  # Fallback rate

def verify_paystack_signature(signature, body, secret):
    """Verify Paystack webhook signature"""
    hash_object = hmac.new(secret.encode('utf-8'), body, hashlib.sha512)
    return hash_object.hexdigest() == signature

# Admin Helper Functions
def create_notification(user_id: str, title: str, message: str, type: str = "info"):
    """Create a notification for a user"""
    notification_doc = {
        "notification_id": str(uuid.uuid4()),
        "user_id": user_id,
        "title": title,
        "message": message,
        "type": type,  # "info", "success", "warning", "error"
        "read": False,
        "created_at": datetime.utcnow()
    }
    notifications_collection.insert_one(notification_doc)
    return notification_doc

def get_user_balance(user_id: str) -> float:
    """Get user balance - unlimited for admin"""
    user = users_collection.find_one({"user_id": user_id})
    if user and user.get("is_admin"):
        return float('inf')  # Unlimited balance for admin
    return user.get("total_earnings", 0.0) if user else 0.0

# Fixed Mining system
async def process_mining():
    """Process mining for all active tokens every 2 hours"""
    try:
        logger.info("🚀 Starting mining process...")
        tokens = list(tokens_collection.find({"active": True}))
        total_tokens_processed = 0
        total_earnings_distributed = 0.0
        
        for token in tokens:
            try:
                # Skip admin tokens from mining
                owner = users_collection.find_one({"user_id": token["owner_id"]})
                if owner and owner.get("is_admin"):
                    continue
                
                # Calculate earnings based on boost level
                base_earning = 0.70
                boost_level = token.get('boost_level', 0)
                earning = base_earning * (2 ** boost_level)
                
                # Update token earnings
                tokens_collection.update_one(
                    {"token_id": token["token_id"]},
                    {
                        "$inc": {"total_earnings": earning},
                        "$set": {"last_mining": datetime.utcnow()},
                        "$push": {"mining_history": {
                            "amount": earning,
                            "timestamp": datetime.utcnow(),
                            "boost_level": boost_level
                        }}
                    }
                )
                
                # Update user total earnings (skip admin)
                if not owner.get("is_admin"):
                    users_collection.update_one(
                        {"user_id": token["owner_id"]},
                        {"$inc": {"total_earnings": earning}}
                    )
                
                total_tokens_processed += 1
                total_earnings_distributed += earning
                
                logger.info(f"💰 Token {token['name']} (Level {boost_level}) earned ${earning:.2f}")
                
            except Exception as token_error:
                logger.error(f"❌ Error processing token {token.get('token_id', 'unknown')}: {token_error}")
        
        # Log mining session
        mining_logs_collection.insert_one({
            "timestamp": datetime.utcnow(),
            "tokens_processed": total_tokens_processed,
            "total_earnings_distributed": total_earnings_distributed,
            "status": "success"
        })
        
        logger.info(f"✅ Mining completed! Processed {total_tokens_processed} tokens, distributed ${total_earnings_distributed:.2f}")
        
    except Exception as e:
        logger.error(f"❌ Mining error: {e}")
        # Log failed mining attempt
        mining_logs_collection.insert_one({
            "timestamp": datetime.utcnow(),
            "tokens_processed": 0,
            "total_earnings_distributed": 0.0,
            "status": "failed",
            "error": str(e)
        })

async def mining_scheduler():
    """Background task that runs mining every 2 hours"""
    logger.info("⏰ Mining scheduler started - will run every 2 hours")
    
    while True:
        try:
            await process_mining()
            # Wait for 2 hours (7200 seconds)
            await asyncio.sleep(7200)
        except Exception as e:
            logger.error(f"❌ Mining scheduler error: {e}")
            # Wait 10 minutes before retry if there's an error
            await asyncio.sleep(600)

# Lifespan event handler
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("🚀 ProfitPilot API starting...")
    
    # Start the mining background task
    global mining_task
    mining_task = asyncio.create_task(mining_scheduler())
    logger.info("⛏️ Mining system initialized")
    
    # Run initial mining after 30 seconds (for testing)
    asyncio.create_task(asyncio.sleep(30))
    asyncio.create_task(process_mining())
    
    yield
    
    # Shutdown
    logger.info("🛑 ProfitPilot API shutting down...")
    if mining_task:
        mining_task.cancel()
        try:
            await mining_task
        except asyncio.CancelledError:
            logger.info("⛏️ Mining task cancelled")

# FastAPI app with lifespan
app = FastAPI(
    title="ProfitPilot API", 
    version="2.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Routes
@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy", 
        "timestamp": datetime.utcnow(),
        "mining_status": "active" if mining_task and not mining_task.done() else "inactive"
    }

# ============================================================================
# AUTHENTICATION ENDPOINTS
# ============================================================================

@app.post("/api/register")
async def register_user(user_data: UserRegister):
    # Check if user exists
    if users_collection.find_one({"email": user_data.email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Generate user data
    user_id = generate_user_id()
    referral_code = generate_referral_code(user_data.email)
    hashed_password = hash_password(user_data.password)
    
    # Create user
    user_doc = {
        "user_id": user_id,
        "email": user_data.email,
        "password": hashed_password,
        "referral_code": referral_code,
        "total_earnings": 0.0,
        "referral_earnings": 0.0,
        "tokens_owned": 0,
        "boosts_used": 0,
        "referrals_count": 0,
        "created_at": datetime.utcnow(),
        "withdrawal_eligible_at": datetime.utcnow() + timedelta(days=180),
        "is_admin": user_data.email == "larryryh76@gmail.com"
    }
    
    users_collection.insert_one(user_doc)
    
    # Process referral if provided
    if user_data.referral_code:
        referrer = users_collection.find_one({"referral_code": user_data.referral_code})
        if referrer:
            # Add $2 to referrer (only if not admin)
            if not referrer.get("is_admin"):
                users_collection.update_one(
                    {"user_id": referrer["user_id"]},
                    {
                        "$inc": {"referral_earnings": 2.0, "total_earnings": 2.0, "referrals_count": 1}
                    }
                )
            
            # Add $2 to new user as well (only if not admin)
            if not user_doc.get("is_admin"):
                users_collection.update_one(
                    {"user_id": user_id},
                    {"$inc": {"referral_earnings": 2.0, "total_earnings": 2.0}}
                )
            
            # Log referral
            referrals_collection.insert_one({
                "referrer_id": referrer["user_id"],
                "referred_id": user_id,
                "amount": 2.0,
                "timestamp": datetime.utcnow()
            })
    
    # Create first free token (only for non-admin users)
    if not user_doc.get("is_admin"):
        token_id = str(uuid.uuid4())
        token_doc = {
            "token_id": token_id,
            "owner_id": user_id,
            "name": "ProfitToken #1",
            "boost_level": 0,
            "total_earnings": 0.0,
            "created_at": datetime.utcnow(),
            "last_mining": datetime.utcnow(),
            "active": True,
            "mining_history": [],
            "boost_history": []
        }
        tokens_collection.insert_one(token_doc)
        
        # Update user token count
        users_collection.update_one(
            {"user_id": user_id},
            {"$inc": {"tokens_owned": 1}}
        )
    
    # Create access token
    access_token = create_access_token(data={"sub": user_id})
    
    logger.info(f"✅ New user registered: {user_id} ({user_data.email})")
    
    return {
        "message": "User registered successfully",
        "access_token": access_token,
        "user_id": user_id,
        "referral_code": referral_code,
        "is_admin": user_doc.get("is_admin", False)
    }

@app.post("/api/login")
async def login_user(user_data: UserLogin):
    user = users_collection.find_one({"email": user_data.email})
    if not user or not verify_password(user_data.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    access_token = create_access_token(data={"sub": user["user_id"]})
    return {
        "access_token": access_token,
        "user_id": user["user_id"],
        "is_admin": user.get("is_admin", False)
    }

@app.get("/api/dashboard")
async def get_dashboard(current_user: dict = Depends(get_current_user)):
    # Get user tokens
    tokens = list(tokens_collection.find({"owner_id": current_user["user_id"]}))
    
    # Calculate next mining time
    next_mining = None
    if tokens:
        last_mining = max([t.get("last_mining", t["created_at"]) for t in tokens])
        next_mining = last_mining + timedelta(hours=2)
    
    # Get fresh user data (in case earnings were updated)
    fresh_user = users_collection.find_one({"user_id": current_user["user_id"]})
    
    # Get user balance (unlimited for admin)
    user_balance = get_user_balance(current_user["user_id"])
    
    return {
        "user": {
            "user_id": fresh_user["user_id"],
            "email": fresh_user["email"],
            "total_earnings": user_balance if user_balance != float('inf') else fresh_user["total_earnings"],
            "referral_earnings": fresh_user["referral_earnings"],
            "tokens_owned": fresh_user["tokens_owned"],
            "boosts_used": fresh_user["boosts_used"],
            "referrals_count": fresh_user["referrals_count"],
            "referral_code": fresh_user["referral_code"],
            "created_at": fresh_user["created_at"],
            "withdrawal_eligible_at": fresh_user["withdrawal_eligible_at"],
            "is_admin": fresh_user.get("is_admin", False),
            "has_unlimited_balance": user_balance == float('inf')
        },
        "tokens": [
            {
                "token_id": token["token_id"],
                "name": token["name"],
                "boost_level": token["boost_level"],
                "total_earnings": token["total_earnings"],
                "created_at": token["created_at"],
                "last_mining": token.get("last_mining"),
                "hourly_rate": 0.70 * (2 ** token["boost_level"]) / 2
            }
            for token in tokens
        ],
        "next_mining": next_mining,
        "stats": {
            "active_assets": len(tokens),
            "total_balance": user_balance if user_balance != float('inf') else fresh_user["total_earnings"],
            "mining_rate": sum([0.70 * (2 ** t["boost_level"]) for t in tokens])
        }
    }

# ============================================================================
# TOKEN MANAGEMENT ENDPOINTS
# ============================================================================

@app.post("/api/tokens/create")
async def create_token(token_data: TokenCreate, current_user: dict = Depends(get_current_user)):
    if current_user.get("is_admin"):
        raise HTTPException(status_code=400, detail="Admin cannot create tokens")
        
    if current_user["tokens_owned"] >= 5:
        raise HTTPException(status_code=400, detail="Maximum 5 tokens allowed")
    
    if current_user["tokens_owned"] > 0:
        raise HTTPException(status_code=400, detail="Additional tokens require payment")
    
    token_id = str(uuid.uuid4())
    token_doc = {
        "token_id": token_id,
        "owner_id": current_user["user_id"],
        "name": token_data.name,
        "boost_level": 0,
        "total_earnings": 0.0,
        "created_at": datetime.utcnow(),
        "last_mining": datetime.utcnow(),
        "active": True,
        "mining_history": [],
        "boost_history": []
    }
    
    tokens_collection.insert_one(token_doc)
    users_collection.update_one(
        {"user_id": current_user["user_id"]},
        {"$inc": {"tokens_owned": 1}}
    )
    
    return {"message": "Token created successfully", "token": token_doc}

# ============================================================================
# PAYMENT ENDPOINTS
# ============================================================================

@app.post("/api/payment/initialize")
async def initialize_payment(payment_data: dict, current_user: dict = Depends(get_current_user)):
    if current_user.get("is_admin"):
        raise HTTPException(status_code=400, detail="Admin cannot make payments")
        
    action = payment_data.get("action")
    token_id = payment_data.get("token_id")
    
    # Calculate amount based on action
    if action == "token":
        if current_user["tokens_owned"] >= 5:
            raise HTTPException(status_code=400, detail="Maximum 5 tokens allowed")
        amount_usd = 5.0
    elif action == "boost":
        if not token_id:
            raise HTTPException(status_code=400, detail="Token ID required for boost")
        
        token = tokens_collection.find_one({"token_id": token_id, "owner_id": current_user["user_id"]})
        if not token:
            raise HTTPException(status_code=404, detail="Token not found")
        
        # Calculate boost cost: $3 * (2 ^ boost_level)
        amount_usd = 3.0 * (2 ** token["boost_level"])
    else:
        raise HTTPException(status_code=400, detail="Invalid action")
    
    # Convert USD to NGN
    exchange_rate = await get_usd_to_ngn_rate()
    amount_ngn = amount_usd * exchange_rate
    amount_kobo = int(amount_ngn * 100)  # Convert to kobo
    
    # Initialize Paystack payment
    paystack_data = {
        "email": current_user["email"],
        "amount": amount_kobo,
        "currency": "NGN",
        "reference": f"pp_{action}_{uuid.uuid4().hex[:12]}",
        "metadata": {
            "user_id": current_user["user_id"],
            "action": action,
            "token_id": token_id,
            "amount_usd": amount_usd
        }
    }
    
    headers = {
        "Authorization": f"Bearer {PAYSTACK_SECRET_KEY}",
        "Content-Type": "application/json"
    }
    
    response = requests.post(
        "https://api.paystack.co/transaction/initialize",
        json=paystack_data,
        headers=headers
    )
    
    if response.status_code == 200:
        data = response.json()
        return {
            "authorization_url": data["data"]["authorization_url"],
            "reference": data["data"]["reference"],
            "amount_usd": amount_usd,
            "amount_ngn": amount_ngn
        }
    else:
        raise HTTPException(status_code=400, detail="Payment initialization failed")

@app.post("/api/payment/verify")
async def verify_payment(payment_data: PaymentVerification, current_user: dict = Depends(get_current_user)):
    if current_user.get("is_admin"):
        raise HTTPException(status_code=400, detail="Admin cannot verify payments")
        
    # Verify payment with Paystack
    headers = {
        "Authorization": f"Bearer {PAYSTACK_SECRET_KEY}",
    }
    
    response = requests.get(
        f"https://api.paystack.co/transaction/verify/{payment_data.reference}",
        headers=headers
    )
    
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Payment verification failed")
    
    data = response.json()
    if data["data"]["status"] != "success":
        raise HTTPException(status_code=400, detail="Payment not successful")
    
    # Process payment based on action
    metadata = data["data"]["metadata"]
    action = metadata["action"]
    
    if action == "token":
        # Create new token
        token_id = str(uuid.uuid4())
        token_count = current_user["tokens_owned"] + 1
        token_doc = {
            "token_id": token_id,
            "owner_id": current_user["user_id"],
            "name": f"ProfitToken #{token_count}",
            "boost_level": 0,
            "total_earnings": 0.0,
            "created_at": datetime.utcnow(),
            "last_mining": datetime.utcnow(),
            "active": True,
            "mining_history": [],
            "boost_history": []
        }
        tokens_collection.insert_one(token_doc)
        users_collection.update_one(
            {"user_id": current_user["user_id"]},
            {"$inc": {"tokens_owned": 1}}
        )
        
    elif action == "boost":
        # Boost token
        token_id = metadata["token_id"]
        token = tokens_collection.find_one({"token_id": token_id})
        
        tokens_collection.update_one(
            {"token_id": token_id},
            {
                "$inc": {"boost_level": 1},
                "$push": {"boost_history": {
                    "timestamp": datetime.utcnow(),
                    "cost_usd": metadata["amount_usd"],
                    "new_level": token["boost_level"] + 1
                }}
            }
        )
        
        users_collection.update_one(
            {"user_id": current_user["user_id"]},
            {"$inc": {"boosts_used": 1}}
        )
    
    # Log transaction
    transactions_collection.insert_one({
        "user_id": current_user["user_id"],
        "reference": payment_data.reference,
        "action": action,
        "amount_usd": metadata["amount_usd"],
        "amount_ngn": data["data"]["amount"] / 100,
        "status": "success",
        "paystack_data": data["data"],
        "timestamp": datetime.utcnow()
    })
    
    return {"message": "Payment processed successfully", "action": action}

# ============================================================================
# LEADERBOARD ENDPOINT
# ============================================================================

@app.get("/api/leaderboard")
async def get_leaderboard():
    # Top earners (exclude admin users)
    top_earners = list(users_collection.find(
        {"is_admin": {"$ne": True}},  # Exclude admin users
        {"user_id": 1, "email": 1, "total_earnings": 1, "tokens_owned": 1, "boosts_used": 1}
    ).sort("total_earnings", -1).limit(10))
    
    # Most boosted tokens (exclude admin-owned tokens)
    admin_user_ids = [user["user_id"] for user in users_collection.find({"is_admin": True}, {"user_id": 1})]
    top_tokens = list(tokens_collection.find(
        {"owner_id": {"$nin": admin_user_ids}},  # Exclude admin tokens
        {"name": 1, "boost_level": 1, "total_earnings": 1, "owner_id": 1}
    ).sort("boost_level", -1).limit(10))
    
    return {
        "top_earners": [
            {
                "user_id": user["user_id"],
                "email": user["email"][:3] + "***" + user["email"][-10:],
                "total_earnings": user["total_earnings"],
                "tokens_owned": user["tokens_owned"],
                "boosts_used": user["boosts_used"]
            }
            for user in top_earners
        ],
        "top_tokens": [
            {
                "name": token["name"],
                "boost_level": token["boost_level"],
                "total_earnings": token["total_earnings"],
                "owner_id": token["owner_id"][:8] + "***"
            }
            for token in top_tokens
        ]
    }

# ============================================================================
# USER NOTIFICATION ENDPOINTS
# ============================================================================

@app.get("/api/notifications")
async def get_user_notifications(current_user: dict = Depends(get_current_user)):
    """Get user notifications"""
    notifications = list(notifications_collection.find(
        {"user_id": current_user["user_id"]}
    ).sort("created_at", -1).limit(50))
    
    for notif in notifications:
        notif['_id'] = str(notif['_id'])
    
    # Count unread notifications
    unread_count = notifications_collection.count_documents({
        "user_id": current_user["user_id"],
        "read": False
    })
    
    return {
        "notifications": notifications,
        "unread_count": unread_count
    }

@app.post("/api/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, current_user: dict = Depends(get_current_user)):
    """Mark notification as read"""
    result = notifications_collection.update_one(
        {"notification_id": notification_id, "user_id": current_user["user_id"]},
        {"$set": {"read": True}}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    
    return {"message": "Notification marked as read"}

# ============================================================================
# TASK ENDPOINTS
# ============================================================================

@app.get("/api/tasks")
async def get_available_tasks(current_user: dict = Depends(get_current_user)):
    """Get available tasks for user"""
    # Don't show tasks to admin
    if current_user.get("is_admin"):
        return {"tasks": []}
    
    # Get active tasks that user hasn't completed
    tasks = list(tasks_collection.find({
        "active": True,
        "completed_by": {"$ne": current_user["user_id"]},
        "$or": [
            {"expires_at": None},
            {"expires_at": {"$gt": datetime.utcnow()}}
        ]
    }))
    
    for task in tasks:
        task['_id'] = str(task['_id'])
    
    return {"tasks": tasks}

@app.post("/api/tasks/complete")
async def complete_task(task_complete: TaskComplete, current_user: dict = Depends(get_current_user)):
    """Complete a task and earn reward"""
    if current_user.get("is_admin"):
        raise HTTPException(status_code=400, detail="Admin cannot complete tasks")
    
    task = tasks_collection.find_one({"task_id": task_complete.task_id, "active": True})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found or inactive")
    
    # Check if user already completed this task
    if current_user["user_id"] in task.get("completed_by", []):
        raise HTTPException(status_code=400, detail="Task already completed")
    
    # Check if task is expired
    if task.get("expires_at") and task["expires_at"] < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Task has expired")
    
    # Award reward
    users_collection.update_one(
        {"user_id": current_user["user_id"]},
        {"$inc": {"total_earnings": task["reward"]}}
    )
    
    # Mark task as completed by user
    tasks_collection.update_one(
        {"task_id": task_complete.task_id},
        {"$push": {"completed_by": current_user["user_id"]}}
    )
    
    # Create transaction record
    transactions_collection.insert_one({
        "user_id": current_user["user_id"],
        "reference": f"task_{task_complete.task_id}_{uuid.uuid4().hex[:8]}",
        "action": "task_completion",
        "amount_usd": task["reward"],
        "amount_ngn": 0,
        "status": "success",
        "task_id": task_complete.task_id,
        "task_title": task["title"],
        "timestamp": datetime.utcnow()
    })
    
    # Create notification
    create_notification(
        current_user["user_id"],
        "Task Completed! 🎉",
        f"You've earned ${task['reward']:.2f} for completing '{task['title']}'",
        "success"
    )
    
    return {"message": "Task completed successfully", "reward": task["reward"]}

# ============================================================================
# ENHANCED ADMIN ENDPOINTS
# ============================================================================

@app.get("/api/admin/users")
async def get_all_users(current_user: dict = Depends(get_current_user)):
    """Get all users with pagination and search"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    users = list(users_collection.find({}, {
        "password": 0  # Exclude password from response
    }).sort("created_at", -1))
    
    # Convert ObjectId to string for JSON serialization
    for user in users:
        user['_id'] = str(user['_id'])
        # Get user's tokens
        user_tokens = list(tokens_collection.find({"owner_id": user["user_id"]}))
        user['tokens'] = len(user_tokens)
        user['active_tokens'] = len([t for t in user_tokens if t.get("active", True)])
        
        # Get recent transactions
        user['recent_transactions'] = list(transactions_collection.find(
            {"user_id": user["user_id"]}
        ).sort("timestamp", -1).limit(5))
    
    return {"users": users, "total": len(users)}

@app.get("/api/admin/users/{user_id}")
async def get_user_details(user_id: str, current_user: dict = Depends(get_current_user)):
    """Get detailed user information"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    user = users_collection.find_one({"user_id": user_id}, {"password": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user['_id'] = str(user['_id'])
    
    # Get user's tokens
    tokens = list(tokens_collection.find({"owner_id": user_id}))
    for token in tokens:
        token['_id'] = str(token['_id'])
    
    # Get user's transactions
    transactions = list(transactions_collection.find({"user_id": user_id}).sort("timestamp", -1).limit(20))
    for tx in transactions:
        tx['_id'] = str(tx['_id'])
    
    # Get user's referrals
    referrals = list(referrals_collection.find({"referrer_id": user_id}))
    for ref in referrals:
        ref['_id'] = str(ref['_id'])
    
    # Get user's notifications
    notifications = list(notifications_collection.find({"user_id": user_id}).sort("created_at", -1).limit(10))
    for notif in notifications:
        notif['_id'] = str(notif['_id'])
    
    return {
        "user": user,
        "tokens": tokens,
        "transactions": transactions,
        "referrals": referrals,
        "notifications": notifications
    }

@app.post("/api/admin/send-balance")
async def admin_send_balance(balance_data: AdminSendBalance, current_user: dict = Depends(get_current_user)):
    """Send balance to a user"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Check if user exists
    user = users_collection.find_one({"user_id": balance_data.user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Add balance to user
    users_collection.update_one(
        {"user_id": balance_data.user_id},
        {"$inc": {"total_earnings": balance_data.amount}}
    )
    
    # Create transaction record
    transactions_collection.insert_one({
        "user_id": balance_data.user_id,
        "reference": f"admin_gift_{uuid.uuid4().hex[:12]}",
        "action": "admin_balance_gift",
        "amount_usd": balance_data.amount,
        "amount_ngn": 0,
        "status": "success",
        "admin_reason": balance_data.reason,
        "admin_id": current_user["user_id"],
        "timestamp": datetime.utcnow()
    })
    
    # Create notification for user
    create_notification(
        balance_data.user_id,
        "Balance Added! 💰",
        f"Admin has added ${balance_data.amount:.2f} to your account. Reason: {balance_data.reason}",
        "success"
    )
    
    logger.info(f"Admin {current_user['user_id']} sent ${balance_data.amount:.2f} to {balance_data.user_id}")
    
    return {"message": "Balance sent successfully", "amount": balance_data.amount}

@app.post("/api/admin/create-task")
async def admin_create_task(task_data: AdminCreateTask, current_user: dict = Depends(get_current_user)):
    """Create a task for users"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    task_id = str(uuid.uuid4())
    task_doc = {
        "task_id": task_id,
        "title": task_data.title,
        "description": task_data.description,
        "reward": task_data.reward,
        "type": task_data.type,
        "requirements": task_data.requirements,
        "expires_at": task_data.expires_at,
        "created_by": current_user["user_id"],
        "created_at": datetime.utcnow(),
        "active": True,
        "completed_by": []
    }
    
    tasks_collection.insert_one(task_doc)
    
    # Broadcast notification about new task
    all_users = list(users_collection.find({"is_admin": {"$ne": True}}, {"user_id": 1}))
    for user in all_users:
        create_notification(
            user["user_id"],
            f"New Task Available! 🎯",
            f"{task_data.title} - Earn ${task_data.reward:.2f}",
            "info"
        )
    
    logger.info(f"Admin {current_user['user_id']} created task: {task_data.title}")
    
    return {"message": "Task created successfully", "task_id": task_id}

@app.post("/api/admin/give-boost")
async def admin_give_boost(boost_data: AdminGiveBoost, current_user: dict = Depends(get_current_user)):
    """Give boost to user's token"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Check if user and token exist
    user = users_collection.find_one({"user_id": boost_data.user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    token = tokens_collection.find_one({"token_id": boost_data.token_id, "owner_id": boost_data.user_id})
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")
    
    # Apply boost
    tokens_collection.update_one(
        {"token_id": boost_data.token_id},
        {
            "$inc": {"boost_level": boost_data.boost_levels},
            "$push": {"boost_history": {
                "timestamp": datetime.utcnow(),
                "boost_levels": boost_data.boost_levels,
                "admin_given": True,
                "admin_id": current_user["user_id"],
                "reason": boost_data.reason,
                "new_level": token["boost_level"] + boost_data.boost_levels
            }}
        }
    )
    
    # Update user boost count
    users_collection.update_one(
        {"user_id": boost_data.user_id},
        {"$inc": {"boosts_used": boost_data.boost_levels}}
    )
    
    # Create notification
    create_notification(
        boost_data.user_id,
        "Token Boosted! 🚀",
        f"Admin has boosted your token '{token['name']}' by {boost_data.boost_levels} levels. Reason: {boost_data.reason}",
        "success"
    )
    
    logger.info(f"Admin {current_user['user_id']} boosted token {boost_data.token_id} by {boost_data.boost_levels} levels")
    
    return {"message": "Boost applied successfully", "new_level": token["boost_level"] + boost_data.boost_levels}

@app.post("/api/admin/broadcast")
async def admin_broadcast(broadcast_data: AdminBroadcast, current_user: dict = Depends(get_current_user)):
    """Broadcast message to all users"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    broadcast_id = str(uuid.uuid4())
    
    # Create broadcast record
    broadcast_doc = {
        "broadcast_id": broadcast_id,
        "title": broadcast_data.title,
        "message": broadcast_data.message,
        "type": broadcast_data.type,
        "priority": broadcast_data.priority,
        "admin_id": current_user["user_id"],
        "created_at": datetime.utcnow(),
        "recipient_count": 0
    }
    
    # Get all non-admin users
    all_users = list(users_collection.find({"is_admin": {"$ne": True}}, {"user_id": 1}))
    
    # Send notification to all users
    for user in all_users:
        create_notification(
            user["user_id"],
            broadcast_data.title,
            broadcast_data.message,
            broadcast_data.type
        )
    
    broadcast_doc["recipient_count"] = len(all_users)
    broadcasts_collection.insert_one(broadcast_doc)
    
    logger.info(f"Admin {current_user['user_id']} broadcast message to {len(all_users)} users")
    
    return {"message": "Broadcast sent successfully", "recipients": len(all_users)}

@app.get("/api/admin/broadcasts")
async def get_admin_broadcasts(current_user: dict = Depends(get_current_user)):
    """Get all admin broadcasts"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    broadcasts = list(broadcasts_collection.find({}).sort("created_at", -1).limit(50))
    for broadcast in broadcasts:
        broadcast['_id'] = str(broadcast['_id'])
    
    return {"broadcasts": broadcasts}

@app.get("/api/admin/tasks")
async def get_admin_tasks(current_user: dict = Depends(get_current_user)):
    """Get all tasks created by admin"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    tasks = list(tasks_collection.find({}).sort("created_at", -1))
    for task in tasks:
        task['_id'] = str(task['_id'])
        task['completion_count'] = len(task.get('completed_by', []))
    
    return {"tasks": tasks}

@app.post("/api/admin/trigger-mining")
async def trigger_mining(current_user: dict = Depends(get_current_user)):
    """Manual mining trigger for testing (admin only)"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    await process_mining()
    return {"message": "Mining process triggered successfully"}

@app.get("/api/admin/mining-logs")
async def get_mining_logs(current_user: dict = Depends(get_current_user)):
    """Get recent mining logs (admin only)"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    logs = list(mining_logs_collection.find({}).sort("timestamp", -1).limit(20))
    
    # Convert ObjectId to string for JSON serialization
    for log in logs:
        log['_id'] = str(log['_id'])
    
    return {"mining_logs": logs}

@app.get("/api/admin/stats")
async def get_admin_stats(current_user: dict = Depends(get_current_user)):
    """Enhanced admin statistics"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Basic stats
    total_users = users_collection.count_documents({"is_admin": {"$ne": True}})
    total_tokens = tokens_collection.count_documents({})
    total_transactions = transactions_collection.count_documents({})
    total_tasks = tasks_collection.count_documents({})
    total_broadcasts = broadcasts_collection.count_documents({})
    
    # Earnings stats
    total_earnings = users_collection.aggregate([
        {"$match": {"is_admin": {"$ne": True}}},
        {"$group": {"_id": None, "total": {"$sum": "$total_earnings"}}}
    ])
    total_earnings = list(total_earnings)[0]["total"] if list(total_earnings) else 0
    
    # Recent activity
    recent_users = list(users_collection.find(
        {"is_admin": {"$ne": True}}, 
        {"password": 0}
    ).sort("created_at", -1).limit(5))
    
    recent_transactions = list(transactions_collection.find({}).sort("timestamp", -1).limit(10))
    
    # Convert ObjectIds
    for user in recent_users:
        user['_id'] = str(user['_id'])
    for tx in recent_transactions:
        tx['_id'] = str(tx['_id'])
    
    return {
        "total_users": total_users,
        "total_tokens": total_tokens,
        "total_transactions": total_transactions,
        "total_tasks": total_tasks,
        "total_broadcasts": total_broadcasts,
        "total_platform_earnings": total_earnings,
        "recent_users": recent_users,
        "recent_transactions": recent_transactions
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
