from fastapi import FastAPI, HTTPException, Depends, status
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
from threading import Timer
import logging

# Environment variables
MONGO_URL = os.getenv("MONGO_URI", "mongodb://localhost:27017")  # Render uses MONGO_URI
DB_NAME = os.getenv("DB_NAME", "profitpilot")

# Secrets
JWT_SECRET = os.getenv("JWT_SECRET", "SuperSecretKey123")  # Secure fallback for local dev
PAYSTACK_SECRET_KEY = os.getenv(
    "PAYSTACK_SECRET_KEY",
    "sk_live_b41107e30aa0682bdfbf68a60dbc3b49da6da6fa"
)
PAYSTACK_PUBLIC_KEY = os.getenv(
    "PAYSTACK_PUBLIC_KEY",
    "pk_live_561c88fdbc97f356950fc7d9881101e4cb074707"
)

# FastAPI app
app = FastAPI(title="ProfitPilot API", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins (adjust in production if needed)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# MongoDB connection
try:
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]

    # Collections
    users_collection = db.users
    tokens_collection = db.tokens
    transactions_collection = db.transactions
    referrals_collection = db.referrals

    print(f"✅ Connected to MongoDB at: {MONGO_URL}")
except Exception as e:
    print("❌ MongoDB connection failed:", e)

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

# Mining system
async def process_mining():
    """Process mining for all active tokens every 2 hours"""
    try:
        tokens = list(tokens_collection.find({"active": True}))
        for token in tokens:
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
            
            # Update user total earnings
            users_collection.update_one(
                {"user_id": token["owner_id"]},
                {"$inc": {"total_earnings": earning}}
            )
        
        print(f"Mining processed for {len(tokens)} tokens")
    except Exception as e:
        print(f"Mining error: {e}")

# Start mining timer
def start_mining_timer():
    Timer(7200.0, lambda: asyncio.create_task(process_mining())).start()  # 2 hours
    start_mining_timer()

# API Routes
@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow()}

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
        "withdrawal_eligible_at": datetime.utcnow() + timedelta(days=180),  # 6 months
        "is_admin": user_data.email == "larryryh76@gmail.com"
    }
    
    users_collection.insert_one(user_doc)
    
    # Process referral if provided
    if user_data.referral_code:
        referrer = users_collection.find_one({"referral_code": user_data.referral_code})
        if referrer:
            # Add $2 to referrer
            users_collection.update_one(
                {"user_id": referrer["user_id"]},
                {
                    "$inc": {"referral_earnings": 2.0, "total_earnings": 2.0, "referrals_count": 1}
                }
            )
            
            # Log referral
            referrals_collection.insert_one({
                "referrer_id": referrer["user_id"],
                "referred_id": user_id,
                "amount": 2.0,
                "timestamp": datetime.utcnow()
            })
    
    # Create first free token
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
    
    return {
        "message": "User registered successfully",
        "access_token": access_token,
        "user_id": user_id,
        "referral_code": referral_code
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
    
    return {
        "user": {
            "user_id": current_user["user_id"],
            "email": current_user["email"],
            "total_earnings": current_user["total_earnings"],
            "referral_earnings": current_user["referral_earnings"],
            "tokens_owned": current_user["tokens_owned"],
            "boosts_used": current_user["boosts_used"],
            "referrals_count": current_user["referrals_count"],
            "referral_code": current_user["referral_code"],
            "created_at": current_user["created_at"],
            "withdrawal_eligible_at": current_user["withdrawal_eligible_at"],
            "is_admin": current_user.get("is_admin", False)
        },
        "tokens": [
            {
                "token_id": token["token_id"],
                "name": token["name"],
                "boost_level": token["boost_level"],
                "total_earnings": token["total_earnings"],
                "created_at": token["created_at"],
                "last_mining": token.get("last_mining"),
                "hourly_rate": 0.70 * (2 ** token["boost_level"]) / 2  # Per hour rate
            }
            for token in tokens
        ],
        "next_mining": next_mining,
        "stats": {
            "active_assets": len(tokens),
            "total_balance": current_user["total_earnings"],
            "mining_rate": sum([0.70 * (2 ** t["boost_level"]) for t in tokens])
        }
    }

@app.post("/api/tokens/create")
async def create_token(token_data: TokenCreate, current_user: dict = Depends(get_current_user)):
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

@app.post("/api/payment/initialize")
async def initialize_payment(payment_data: dict, current_user: dict = Depends(get_current_user)):
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

@app.get("/api/leaderboard")
async def get_leaderboard():
    # Top earners
    top_earners = list(users_collection.find(
        {},
        {"user_id": 1, "email": 1, "total_earnings": 1, "tokens_owned": 1, "boosts_used": 1}
    ).sort("total_earnings", -1).limit(10))
    
    # Most boosted tokens
    top_tokens = list(tokens_collection.find(
        {},
        {"name": 1, "boost_level": 1, "total_earnings": 1, "owner_id": 1}
    ).sort("boost_level", -1).limit(10))
    
    return {
        "top_earners": [
            {
                "user_id": user["user_id"],
                "email": user["email"][:3] + "***" + user["email"][-10:],  # Anonymize
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
                "owner_id": token["owner_id"][:8] + "***"  # Anonymize
            }
            for token in top_tokens
        ]
    }

@app.get("/api/admin/stats")
async def get_admin_stats(current_user: dict = Depends(get_current_user)):
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    total_users = users_collection.count_documents({})
    total_tokens = tokens_collection.count_documents({})
    total_transactions = transactions_collection.count_documents({})
    total_earnings = users_collection.aggregate([
        {"$group": {"_id": None, "total": {"$sum": "$total_earnings"}}}
    ])
    total_earnings = list(total_earnings)[0]["total"] if list(total_earnings) else 0
    
    return {
        "total_users": total_users,
        "total_tokens": total_tokens,
        "total_transactions": total_transactions,
        "total_platform_earnings": total_earnings,
        "recent_users": list(users_collection.find({}).sort("created_at", -1).limit(5)),
        "recent_transactions": list(transactions_collection.find({}).sort("timestamp", -1).limit(10))
    }

# Start mining when server starts
@app.on_event("startup")
async def startup_event():
    print("ProfitPilot API started")
    print("Mining system will run every 2 hours")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
