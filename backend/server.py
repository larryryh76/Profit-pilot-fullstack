from fastapi import FastAPI, HTTPException, Depends, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient
from pydantic import BaseModel, EmailStr, Field, validator
from passlib.context import CryptContext
from datetime import datetime, timedelta
import jwt
import os
import uuid
import requests
import hashlib
import hmac
from typing import Optional, List, Dict, Any
import asyncio
import logging
from contextlib import asynccontextmanager

# Environment variables
MONGO_URL = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "profitpilot")
JWT_SECRET = os.getenv("JWT_SECRET", "SuperSecretKey123")
PAYSTACK_SECRET_KEY = os.getenv("PAYSTACK_SECRET_KEY", "sk_live_b41107e30aa0682bdfbf68a60dbc3b49da6da6fa")
PAYSTACK_PUBLIC_KEY = os.getenv("PAYSTACK_PUBLIC_KEY", "pk_live_561c88fdbc97f356950fc7d9881101e4cb074707")

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
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
    user_sessions_collection = db.user_sessions
    currency_rates_collection = db.currency_rates
    
    logger.info(f"✅ Connected to MongoDB at: {MONGO_URL}")
except Exception as e:
    logger.error(f"❌ MongoDB connection failed: {e}")

# Password hashing and security
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

# ============================================================================
# PROFESSIONAL PYDANTIC MODELS WITH VALIDATION
# ============================================================================

class UserRegister(BaseModel):
    email: EmailStr
    password: str
    referral_code: Optional[str] = None

    @validator('password')
    def validate_password(cls, v):
        if len(v) < 6:
            raise ValueError('Password must be at least 6 characters long')
        return v

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class ProfileUpdate(BaseModel):
    preferred_currency: Optional[str] = None
    theme: Optional[str] = Field(None, regex="^(light|dark)$")
    notifications_enabled: Optional[bool] = None

class PaymentVerification(BaseModel):
    reference: str
    token_id: Optional[str] = None
    action: str

class AdminSendBalance(BaseModel):
    user_id: str
    amount: float = Field(..., gt=0)
    reason: str

class AdminCreateTask(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(..., min_length=1, max_length=1000)
    reward: float = Field(..., gt=0)
    type: str = Field(..., regex="^(daily|one_time|repeatable)$")
    requirements: Optional[str] = None
    expires_at: Optional[datetime] = None
    verification_type: str = Field(default="manual", regex="^(manual|automatic|external)$")
    external_url: Optional[str] = None

class AdminBroadcast(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    message: str = Field(..., min_length=1, max_length=1000)
    type: str = Field(..., regex="^(info|warning|success|error)$")
    priority: str = Field(..., regex="^(low|medium|high)$")

class TaskComplete(BaseModel):
    task_id: str
    verification_data: Optional[Dict[str, Any]] = None

# ============================================================================
# PROFESSIONAL UTILITY FUNCTIONS
# ============================================================================

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
        update_user_session(user_id)
        return user
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

def generate_referral_code(email: str) -> str:
    return f"PP{hashlib.md5(email.encode()).hexdigest()[:8].upper()}"

def generate_user_id() -> str:
    return f"PP-{str(uuid.uuid4()).split('-')[0].upper()}"

# ============================================================================
# MULTI-CURRENCY SYSTEM WITH COUNTRY DETECTION
# ============================================================================

async def get_currency_rates():
    """Get real-time currency conversion rates"""
    try:
        response = requests.get("https://api.exchangerate-api.com/v4/latest/USD", timeout=10)
        data = response.json()
        
        currency_rates_collection.update_one(
            {"_id": "latest_rates"},
            {"$set": {"rates": data['rates'], "updated_at": datetime.utcnow()}},
            upsert=True
        )
        
        return data['rates']
    except Exception as e:
        logger.error(f"Error fetching currency rates: {e}")
        cached_rates = currency_rates_collection.find_one({"_id": "latest_rates"})
        if cached_rates:
            return cached_rates['rates']
        return {"USD": 1, "NGN": 1500, "GBP": 0.75, "EUR": 0.85, "CAD": 1.25, "AUD": 1.35, "JPY": 110, "INR": 75, "ZAR": 15}

async def detect_user_country(request: Request):
    """Detect user's country from IP address"""
    try:
        client_ip = request.client.host
        if client_ip in ["127.0.0.1", "localhost"]:
            return "NG"
        
        response = requests.get(f"http://ipinfo.io/{client_ip}/json", timeout=5)
        data = response.json()
        return data.get('country', 'NG')
    except:
        return "NG"

def get_currency_for_country(country_code: str) -> str:
    """Map country code to currency"""
    currency_map = {
        "NG": "NGN", "US": "USD", "GB": "GBP", "DE": "EUR", "FR": "EUR",
        "CA": "CAD", "AU": "AUD", "JP": "JPY", "IN": "INR", "ZA": "ZAR"
    }
    return currency_map.get(country_code, "USD")

async def convert_currency(amount: float, from_currency: str, to_currency: str) -> float:
    """Convert amount from one currency to another"""
    if from_currency == to_currency:
        return amount
    
    rates = await get_currency_rates()
    usd_amount = amount / rates.get(from_currency, 1)
    converted_amount = usd_amount * rates.get(to_currency, 1)
    return round(converted_amount, 2)

# ============================================================================
# SESSION MANAGEMENT
# ============================================================================

def update_user_session(user_id: str):
    """Update user's last active time"""
    user_sessions_collection.update_one(
        {"user_id": user_id},
        {
            "$set": {"last_active": datetime.utcnow()},
            "$setOnInsert": {"first_login": datetime.utcnow()}
        },
        upsert=True
    )

def get_online_users_count():
    """Get count of users online in last 5 minutes"""
    five_minutes_ago = datetime.utcnow() - timedelta(minutes=5)
    return user_sessions_collection.count_documents({
        "last_active": {"$gte": five_minutes_ago}
    })

# ============================================================================
# NOTIFICATION SYSTEM
# ============================================================================

def create_notification(user_id: str, title: str, message: str, type: str = "info"):
    """Create a notification for a user"""
    notification_doc = {
        "notification_id": str(uuid.uuid4()),
        "user_id": user_id,
        "title": title,
        "message": message,
        "type": type,
        "read": False,
        "created_at": datetime.utcnow()
    }
    notifications_collection.insert_one(notification_doc)
    return notification_doc

# ============================================================================
# PROFESSIONAL MINING SYSTEM (NO ADMIN TRIGGERS)
# ============================================================================

async def process_mining():
    """Automated mining process - no admin intervention"""
    try:
        logger.info("🚀 Starting automated mining process...")
        tokens = list(tokens_collection.find({"active": True}))
        total_tokens_processed = 0
        total_earnings_distributed = 0.0
        
        for token in tokens:
            try:
                owner = users_collection.find_one({"user_id": token["owner_id"]})
                if owner and owner.get("is_admin"):
                    continue
                
                base_earning = 0.70
                boost_level = token.get('boost_level', 0)
                earning = base_earning * (2 ** boost_level)
                
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
                
                if not owner.get("is_admin"):
                    users_collection.update_one(
                        {"user_id": token["owner_id"]},
                        {"$inc": {"total_earnings": earning}}
                    )
                    
                    create_notification(
                        token["owner_id"],
                        "Mining Completed! 💰",
                        f"Your token '{token['name']}' earned ${earning:.2f}",
                        "success"
                    )
                
                total_tokens_processed += 1
                total_earnings_distributed += earning
                
            except Exception as token_error:
                logger.error(f"❌ Error processing token {token.get('token_id', 'unknown')}: {token_error}")
        
        mining_logs_collection.insert_one({
            "timestamp": datetime.utcnow(),
            "tokens_processed": total_tokens_processed,
            "total_earnings_distributed": total_earnings_distributed,
            "status": "success"
        })
        
        logger.info(f"✅ Mining completed! Processed {total_tokens_processed} tokens, distributed ${total_earnings_distributed:.2f}")
        
    except Exception as e:
        logger.error(f"❌ Mining error: {e}")
        mining_logs_collection.insert_one({
            "timestamp": datetime.utcnow(),
            "tokens_processed": 0,
            "total_earnings_distributed": 0.0,
            "status": "failed",
            "error": str(e)
        })

async def mining_scheduler():
    """Automated mining scheduler - runs every 2 hours"""
    logger.info("⏰ Automated mining scheduler started - runs every 2 hours")
    
    while True:
        try:
            await process_mining()
            await asyncio.sleep(7200)  # 2 hours
        except Exception as e:
            logger.error(f"❌ Mining scheduler error: {e}")
            await asyncio.sleep(600)  # Retry in 10 minutes

# ============================================================================
# LIFESPAN MANAGEMENT
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 ProfitPilot Professional API starting...")
    
    global mining_task
    mining_task = asyncio.create_task(mining_scheduler())
    logger.info("⛏️ Automated mining system initialized")
    
    yield
    
    logger.info("🛑 ProfitPilot API shutting down...")
    if mining_task:
        mining_task.cancel()
        try:
            await mining_task
        except asyncio.CancelledError:
            logger.info("⛏️ Mining task cancelled")

# ============================================================================
# FASTAPI APPLICATION
# ============================================================================

app = FastAPI(
    title="ProfitPilot Professional API", 
    version="3.0.0",
    description="Professional crypto earning platform with multi-currency support",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================================
# API ENDPOINTS
# ============================================================================

@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy", 
        "timestamp": datetime.utcnow(),
        "version": "3.0.0",
        "mining_status": "automated" if mining_task and not mining_task.done() else "inactive"
    }

@app.post("/api/register")
async def register_user(user_data: UserRegister, request: Request):
    if users_collection.find_one({"email": user_data.email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    
    user_id = generate_user_id()
    referral_code = generate_referral_code(user_data.email)
    hashed_password = hash_password(user_data.password)
    
    country = await detect_user_country(request)
    preferred_currency = get_currency_for_country(country)
    
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
        "is_admin": user_data.email == "larryryh76@gmail.com",
        "country": country,
        "preferred_currency": preferred_currency,
        "theme": "light",
        "notifications_enabled": True
    }
    
    users_collection.insert_one(user_doc)
    
    # Process referral
    if user_data.referral_code:
        referrer = users_collection.find_one({"referral_code": user_data.referral_code})
        if referrer and not referrer.get("is_admin"):
            users_collection.update_one(
                {"user_id": referrer["user_id"]},
                {"$inc": {"referral_earnings": 2.0, "total_earnings": 2.0, "referrals_count": 1}}
            )
            
            if not user_doc.get("is_admin"):
                users_collection.update_one(
                    {"user_id": user_id},
                    {"$inc": {"referral_earnings": 2.0, "total_earnings": 2.0}}
                )
            
            referrals_collection.insert_one({
                "referrer_id": referrer["user_id"],
                "referred_id": user_id,
                "amount": 2.0,
                "timestamp": datetime.utcnow()
            })
    
    # Create first free token for non-admin users
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
        users_collection.update_one({"user_id": user_id}, {"$inc": {"tokens_owned": 1}})
    
    access_token = create_access_token(data={"sub": user_id})
    update_user_session(user_id)
    
    logger.info(f"✅ New user registered: {user_id} ({user_data.email}) from {country}")
    
    return {
        "message": "User registered successfully",
        "access_token": access_token,
        "user_id": user_id,
        "referral_code": referral_code,
        "is_admin": user_doc.get("is_admin", False),
        "preferred_currency": preferred_currency
    }

@app.post("/api/login")
async def login_user(user_data: UserLogin):
    user = users_collection.find_one({"email": user_data.email})
    if not user or not verify_password(user_data.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    access_token = create_access_token(data={"sub": user["user_id"]})
    update_user_session(user["user_id"])
    
    return {
        "access_token": access_token,
        "user_id": user["user_id"],
        "is_admin": user.get("is_admin", False),
        "preferred_currency": user.get("preferred_currency", "USD")
    }

@app.get("/api/dashboard")
async def get_dashboard(current_user: dict = Depends(get_current_user)):
    tokens = list(tokens_collection.find({"owner_id": current_user["user_id"]}))
    
    next_mining = None
    if tokens:
        last_mining = max([t.get("last_mining", t["created_at"]) for t in tokens])
        next_mining = last_mining + timedelta(hours=2)
    
    fresh_user = users_collection.find_one({"user_id": current_user["user_id"]})
    user_currency = fresh_user.get("preferred_currency", "USD")
    
    total_earnings_converted = await convert_currency(
        fresh_user["total_earnings"], "USD", user_currency
    )
    referral_earnings_converted = await convert_currency(
        fresh_user["referral_earnings"], "USD", user_currency
    )
    
    return {
        "user": {
            "user_id": fresh_user["user_id"],
            "email": fresh_user["email"],
            "total_earnings": fresh_user["total_earnings"],
            "total_earnings_converted": total_earnings_converted,
            "referral_earnings": fresh_user["referral_earnings"],
            "referral_earnings_converted": referral_earnings_converted,
            "tokens_owned": fresh_user["tokens_owned"],
            "boosts_used": fresh_user["boosts_used"],
            "referrals_count": fresh_user["referrals_count"],
            "referral_code": fresh_user["referral_code"],
            "created_at": fresh_user["created_at"],
            "withdrawal_eligible_at": fresh_user["withdrawal_eligible_at"],
            "is_admin": fresh_user.get("is_admin", False),
            "preferred_currency": user_currency,
            "theme": fresh_user.get("theme", "light"),
            "notifications_enabled": fresh_user.get("notifications_enabled", True)
        },
        "tokens": [
            {
                "token_id": token["token_id"],
                "name": token["name"],
                "boost_level": token["boost_level"],
                "total_earnings": token["total_earnings"],
                "total_earnings_converted": await convert_currency(
                    token["total_earnings"], "USD", user_currency
                ),
                "created_at": token["created_at"],
                "last_mining": token.get("last_mining"),
                "hourly_rate": 0.70 * (2 ** token["boost_level"]) / 2
            }
            for token in tokens
        ],
        "next_mining": next_mining,
        "stats": {
            "active_assets": len(tokens),
            "total_balance": fresh_user["total_earnings"],
            "total_balance_converted": total_earnings_converted,
            "mining_rate": sum([0.70 * (2 ** t["boost_level"]) for t in tokens]),
            "currency": user_currency
        }
    }

@app.post("/api/profile/update")
async def update_profile(profile_data: ProfileUpdate, current_user: dict = Depends(get_current_user)):
    update_fields = {}
    
    if profile_data.preferred_currency:
        rates = await get_currency_rates()
        if profile_data.preferred_currency not in rates:
            raise HTTPException(status_code=400, detail="Invalid currency code")
        update_fields["preferred_currency"] = profile_data.preferred_currency
    
    if profile_data.theme:
        update_fields["theme"] = profile_data.theme
    
    if profile_data.notifications_enabled is not None:
        update_fields["notifications_enabled"] = profile_data.notifications_enabled
    
    if update_fields:
        users_collection.update_one(
            {"user_id": current_user["user_id"]},
            {"$set": update_fields}
        )
    
    return {"message": "Profile updated successfully", "updated_fields": update_fields}

@app.get("/api/currencies")
async def get_supported_currencies():
    """Get list of supported currencies with current rates"""
    rates = await get_currency_rates()
    supported_currencies = {
        "USD": {"name": "US Dollar", "symbol": "$"},
        "NGN": {"name": "Nigerian Naira", "symbol": "₦"},
        "GBP": {"name": "British Pound", "symbol": "£"},
        "EUR": {"name": "Euro", "symbol": "€"},
        "CAD": {"name": "Canadian Dollar", "symbol": "C$"},
        "AUD": {"name": "Australian Dollar", "symbol": "A$"},
        "JPY": {"name": "Japanese Yen", "symbol": "¥"},
        "INR": {"name": "Indian Rupee", "symbol": "₹"},
        "ZAR": {"name": "South African Rand", "symbol": "R"}
    }
    
    return {
        "currencies": supported_currencies,
        "rates": rates
    }

@app.post("/api/tokens/create")
async def create_token(current_user: dict = Depends(get_current_user)):
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
        "name": f"ProfitToken #{current_user['tokens_owned'] + 1}",
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

@app.post("/api/payment/initialize")
async def initialize_payment(payment_data: dict, current_user: dict = Depends(get_current_user)):
    if current_user.get("is_admin"):
        raise HTTPException(status_code=400, detail="Admin cannot make payments")
        
    action = payment_data.get("action")
    token_id = payment_data.get("token_id")
    
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
        
        amount_usd = 3.0 * (2 ** token["boost_level"])
    else:
        raise HTTPException(status_code=400, detail="Invalid action")
    
    exchange_rate = (await get_currency_rates()).get("NGN", 1500)
    amount_ngn = amount_usd * exchange_rate
    amount_kobo = int(amount_ngn * 100)
    
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
        
    headers = {"Authorization": f"Bearer {PAYSTACK_SECRET_KEY}"}
    
    response = requests.get(
        f"https://api.paystack.co/transaction/verify/{payment_data.reference}",
        headers=headers
    )
    
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Payment verification failed")
    
    data = response.json()
    if data["data"]["status"] != "success":
        raise HTTPException(status_code=400, detail="Payment not successful")
    
    metadata = data["data"]["metadata"]
    action = metadata["action"]
    
    if action == "token":
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

@app.get("/api/notifications")
async def get_user_notifications(current_user: dict = Depends(get_current_user)):
    """Get user notifications"""
    notifications = list(notifications_collection.find(
        {"user_id": current_user["user_id"]}
    ).sort("created_at", -1).limit(50))
    
    for notif in notifications:
        notif['_id'] = str(notif['_id'])
    
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

@app.get("/api/tasks")
async def get_available_tasks(current_user: dict = Depends(get_current_user)):
    """Get available tasks for user"""
    if current_user.get("is_admin"):
        return {"tasks": []}
    
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
    
    if current_user["user_id"] in task.get("completed_by", []):
        raise HTTPException(status_code=400, detail="Task already completed")
    
    if task.get("expires_at") and task["expires_at"] < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Task has expired")
    
    users_collection.update_one(
        {"user_id": current_user["user_id"]},
        {"$inc": {"total_earnings": task["reward"]}}
    )
    
    tasks_collection.update_one(
        {"task_id": task_complete.task_id},
        {"$push": {"completed_by": current_user["user_id"]}}
    )
    
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
    
    create_notification(
        current_user["user_id"],
        "Task Completed! 🎉",
        f"You've earned ${task['reward']:.2f} for completing '{task['title']}'",
        "success"
    )
    
    return {"message": "Task completed successfully", "reward": task["reward"]}

@app.get("/api/leaderboard")
async def get_leaderboard():
    top_earners = list(users_collection.find(
        {"is_admin": {"$ne": True}},
        {"user_id": 1, "email": 1, "total_earnings": 1, "tokens_owned": 1, "boosts_used": 1}
    ).sort("total_earnings", -1).limit(10))
    
    admin_user_ids = [user["user_id"] for user in users_collection.find({"is_admin": True}, {"user_id": 1})]
    top_tokens = list(tokens_collection.find(
        {"owner_id": {"$nin": admin_user_ids}},
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
# PROFESSIONAL ADMIN WORKSPACE ENDPOINTS (NO MINING TRIGGERS)
# ============================================================================

def require_admin(current_user: dict = Depends(get_current_user)):
    """Require admin privileges"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user

@app.get("/api/admin/workspace/dashboard")
async def get_admin_dashboard(current_user: dict = Depends(require_admin)):
    """Professional admin dashboard with comprehensive metrics"""
    
    # Calculate total revenue from payments
    total_revenue = 0
    revenue_pipeline = [
        {"$match": {"action": {"$in": ["token", "boost"]}, "status": "success"}},
        {"$group": {"_id": None, "total": {"$sum": "$amount_usd"}}}
    ]
    revenue_result = list(transactions_collection.aggregate(revenue_pipeline))
    if revenue_result:
        total_revenue = revenue_result[0]["total"]
    
    # User metrics
    total_users = users_collection.count_documents({"is_admin": {"$ne": True}})
    users_online = get_online_users_count()
    
    # Token metrics
    total_tokens = tokens_collection.count_documents({})
    active_tokens = tokens_collection.count_documents({"active": True})
    tokens_bought = transactions_collection.count_documents({"action": "token", "status": "success"})
    
    # Recent activity
    recent_transactions = list(transactions_collection.find({}).sort("timestamp", -1).limit(10))
    recent_users = list(users_collection.find(
        {"is_admin": {"$ne": True}}, 
        {"password": 0}
    ).sort("created_at", -1).limit(5))
    
    # Mining statistics
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_mining = mining_logs_collection.find_one(
        {"timestamp": {"$gte": today_start}, "status": "success"},
        sort=[("timestamp", -1)]
    )
    
    # Task completion stats
    task_stats = list(tasks_collection.aggregate([
        {"$project": {"completion_count": {"$size": {"$ifNull": ["$completed_by", []]}}}},
        {"$group": {"_id": None, "total_completions": {"$sum": "$completion_count"}}}
    ]))
    total_task_completions = task_stats[0]["total_completions"] if task_stats else 0
    
    # Clean up ObjectIds for JSON serialization
    for tx in recent_transactions:
        tx['_id'] = str(tx['_id'])
    for user in recent_users:
        user['_id'] = str(user['_id'])
    
    return {
        "revenue_metrics": {
            "total_revenue": total_revenue,
            "monthly_revenue": 0,
            "daily_revenue": 0
        },
        "user_metrics": {
            "total_users": total_users,
            "users_online": users_online,
            "new_users_today": users_collection.count_documents({
                "created_at": {"$gte": today_start},
                "is_admin": {"$ne": True}
            })
        },
        "token_metrics": {
            "total_tokens": total_tokens,
            "active_tokens": active_tokens,
            "tokens_bought": tokens_bought,
            "boost_purchases": transactions_collection.count_documents({"action": "boost", "status": "success"})
        },
        "platform_activity": {
            "total_transactions": transactions_collection.count_documents({}),
            "total_tasks": tasks_collection.count_documents({}),
            "total_task_completions": total_task_completions,
            "total_broadcasts": broadcasts_collection.count_documents({})
        },
        "mining_status": {
            "last_mining": today_mining["timestamp"] if today_mining else None,
            "tokens_processed_today": today_mining["tokens_processed"] if today_mining else 0,
            "earnings_distributed_today": today_mining["total_earnings_distributed"] if today_mining else 0
        },
        "recent_activity": {
            "recent_transactions": recent_transactions,
            "recent_users": recent_users
        }
    }

@app.get("/api/admin/workspace/users")
async def get_all_users(current_user: dict = Depends(require_admin)):
    """Get all users with comprehensive data"""
    users = list(users_collection.find(
        {"is_admin": {"$ne": True}}, 
        {"password": 0}
    ).sort("created_at", -1))
    
    for user in users:
        user['_id'] = str(user['_id'])
        user_tokens = list(tokens_collection.find({"owner_id": user["user_id"]}))
        user['tokens_count'] = len(user_tokens)
        user['active_tokens_count'] = len([t for t in user_tokens if t.get("active", True)])
        user['total_token_earnings'] = sum([t.get("total_earnings", 0) for t in user_tokens])
        user['recent_transactions_count'] = transactions_collection.count_documents({"user_id": user["user_id"]})
        
        session = user_sessions_collection.find_one({"user_id": user["user_id"]})
        if session:
            last_active = session.get("last_active")
            if last_active and (datetime.utcnow() - last_active).total_seconds() < 300:
                user['online_status'] = "online"
            else:
                user['online_status'] = "offline"
        else:
            user['online_status'] = "offline"
    
    return {"users": users, "total": len(users)}

@app.get("/api/admin/workspace/users/{user_id}")
async def get_user_details(user_id: str, current_user: dict = Depends(require_admin)):
    """Get comprehensive user details"""
    user = users_collection.find_one({"user_id": user_id}, {"password": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user['_id'] = str(user['_id'])
    
    tokens = list(tokens_collection.find({"owner_id": user_id}))
    for token in tokens:
        token['_id'] = str(token['_id'])
    
    transactions = list(transactions_collection.find({"user_id": user_id}).sort("timestamp", -1).limit(20))
    for tx in transactions:
        tx['_id'] = str(tx['_id'])
    
    referrals = list(referrals_collection.find({"referrer_id": user_id}))
    for ref in referrals:
        ref['_id'] = str(ref['_id'])
    
    notifications = list(notifications_collection.find({"user_id": user_id}).sort("created_at", -1).limit(10))
    for notif in notifications:
        notif['_id'] = str(notif['_id'])
    
    session = user_sessions_collection.find_one({"user_id": user_id})
    
    return {
        "user": user,
        "tokens": tokens,
        "transactions": transactions,
        "referrals": referrals,
        "notifications": notifications,
        "session_info": session
    }

@app.post("/api/admin/workspace/send-balance")
async def admin_send_balance(balance_data: AdminSendBalance, current_user: dict = Depends(require_admin)):
    """Send balance to a user"""
    user = users_collection.find_one({"user_id": balance_data.user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    users_collection.update_one(
        {"user_id": balance_data.user_id},
        {"$inc": {"total_earnings": balance_data.amount}}
    )
    
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
    
    create_notification(
        balance_data.user_id,
        "Balance Added! 💰",
        f"Admin has added ${balance_data.amount:.2f} to your account. Reason: {balance_data.reason}",
        "success"
    )
    
    logger.info(f"Admin {current_user['user_id']} sent ${balance_data.amount:.2f} to {balance_data.user_id}")
    
    return {"message": "Balance sent successfully", "amount": balance_data.amount}

@app.post("/api/admin/workspace/create-task")
async def admin_create_task(task_data: AdminCreateTask, current_user: dict = Depends(require_admin)):
    """Create dynamic task with advanced verification options"""
    task_id = str(uuid.uuid4())
    task_doc = {
        "task_id": task_id,
        "title": task_data.title,
        "description": task_data.description,
        "reward": task_data.reward,
        "type": task_data.type,
        "requirements": task_data.requirements,
        "expires_at": task_data.expires_at,
        "verification_type": task_data.verification_type,
        "external_url": task_data.external_url,
        "created_by": current_user["user_id"],
        "created_at": datetime.utcnow(),
        "active": True,
        "completed_by": [],
        "completion_data": []
    }
    
    tasks_collection.insert_one(task_doc)
    
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

@app.get("/api/admin/workspace/tasks")
async def get_admin_tasks(current_user: dict = Depends(require_admin)):
    """Get all tasks with completion statistics"""
    tasks = list(tasks_collection.find({}).sort("created_at", -1))
    for task in tasks:
        task['_id'] = str(task['_id'])
        task['completion_count'] = len(task.get('completed_by', []))
        task['total_rewards_paid'] = task['completion_count'] * task['reward']
    
    return {"tasks": tasks}

@app.put("/api/admin/workspace/tasks/{task_id}/toggle")
async def toggle_task_status(task_id: str, current_user: dict = Depends(require_admin)):
    """Toggle task active status"""
    task = tasks_collection.find_one({"task_id": task_id})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    new_status = not task.get("active", True)
    tasks_collection.update_one(
        {"task_id": task_id},
        {"$set": {"active": new_status}}
    )
    
    return {"message": f"Task {'activated' if new_status else 'deactivated'} successfully"}

@app.post("/api/admin/workspace/broadcast")
async def admin_broadcast(broadcast_data: AdminBroadcast, current_user: dict = Depends(require_admin)):
    """Send broadcast message to all users"""
    broadcast_id = str(uuid.uuid4())
    
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
    
    all_users = list(users_collection.find({"is_admin": {"$ne": True}}, {"user_id": 1}))
    
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

@app.get("/api/admin/workspace/broadcasts")
async def get_admin_broadcasts(current_user: dict = Depends(require_admin)):
    """Get all admin broadcasts"""
    broadcasts = list(broadcasts_collection.find({}).sort("created_at", -1).limit(50))
    for broadcast in broadcasts:
        broadcast['_id'] = str(broadcast['_id'])
    
    return {"broadcasts": broadcasts}

@app.get("/api/admin/workspace/system-status")
async def get_system_status(current_user: dict = Depends(require_admin)):
    """Get comprehensive system status"""
    
    recent_mining = list(mining_logs_collection.find({}).sort("timestamp", -1).limit(10))
    for log in recent_mining:
        log['_id'] = str(log['_id'])
    
    total_users = users_collection.count_documents({})
    active_users = get_online_users_count()
    
    return {
        "system_health": {
            "database_status": "healthy",
            "total_users": total_users,
            "active_users": active_users,
            "system_load": "normal"
        },
        "mining_logs": recent_mining,
        "automated_mining": {
            "status": "active",
            "next_cycle": "Automated every 2 hours",
            "intervention_required": False
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)

