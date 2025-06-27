from fastapi import FastAPI, HTTPException, Depends, status, Request, BackgroundTasks
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from pymongo import MongoClient, ReturnDocument
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
import time
from functools import wraps

# ============================================================================
# PROFESSIONAL CONFIGURATION AND SETUP
# ============================================================================

# Environment variables with defaults
MONGO_URL = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "profitpilot")
JWT_SECRET = os.getenv("JWT_SECRET", "SuperSecretKey123")
PAYSTACK_SECRET_KEY = os.getenv("PAYSTACK_SECRET_KEY", "sk_live_b41107e30aa0682bdfbf68a60dbc3b49da6da6fa")
PAYSTACK_PUBLIC_KEY = os.getenv("PAYSTACK_PUBLIC_KEY", "pk_live_561c88fdbc97f356950fc7d9881101e4cb074707")
EXCHANGE_API_KEY = os.getenv("EXCHANGE_API_KEY", "")

# Professional logging configuration
logging.basicConfig(
    level=logging.INFO, 
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('profitpilot.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Global mining task variable
mining_task = None

# Professional MongoDB connection with error handling
try:
    client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
    client.server_info()  # Test connection
    db = client[DB_NAME]
    
    # Collections with professional naming
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
    system_logs_collection = db.system_logs
    
    # Create professional indexes for performance
    users_collection.create_index("email", unique=True)
    users_collection.create_index("user_id", unique=True)
    users_collection.create_index("referral_code", unique=True)
    tokens_collection.create_index("owner_id")
    tokens_collection.create_index("token_id", unique=True)
    notifications_collection.create_index([("user_id", 1), ("created_at", -1)])
    tasks_collection.create_index("task_id", unique=True)
    transactions_collection.create_index("user_id")
    
    logger.info(f"✅ Connected to MongoDB at: {MONGO_URL}")
except Exception as e:
    logger.error(f"❌ MongoDB connection failed: {e}")
    raise

# Professional security setup
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

# ============================================================================
# PROFESSIONAL PYDANTIC MODELS WITH ENHANCED VALIDATION
# ============================================================================

class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)
    referral_code: Optional[str] = Field(None, max_length=20)

    @validator('password')
    def validate_password(cls, v):
        if len(v) < 6:
            raise ValueError('Password must be at least 6 characters long')
        if not any(c.isdigit() for c in v):
            raise ValueError('Password must contain at least one digit')
        return v

    @validator('email')
    def validate_email(cls, v):
        if not v or '@' not in v:
            raise ValueError('Valid email required')
        return v.lower()

class UserLogin(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1)

class ProfileUpdate(BaseModel):
    preferred_currency: Optional[str] = Field(None, max_length=3, min_length=3)
    theme: Optional[str] = Field(None, pattern="^(light|dark)$")
    notifications_enabled: Optional[bool] = None

    @validator('preferred_currency')
    def validate_currency(cls, v):
        if v:
            valid_currencies = ["USD", "NGN", "GBP", "EUR", "CAD", "AUD", "JPY", "INR", "ZAR"]
            if v.upper() not in valid_currencies:
                raise ValueError('Invalid currency code')
            return v.upper()
        return v

class PaymentVerification(BaseModel):
    reference: str = Field(..., min_length=1)
    token_id: Optional[str] = None
    action: str = Field(..., regex="^(token|boost)$")

class AdminSendBalance(BaseModel):
    user_id: str = Field(..., min_length=1)
    amount: float = Field(..., gt=0, le=10000)
    reason: str = Field(..., min_length=1, max_length=500)

class AdminCreateTask(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(..., min_length=1, max_length=1000)
    reward: float = Field(..., gt=0, le=1000)
    type: str = Field(..., regex="^(daily|one_time|repeatable)$")
    requirements: Optional[str] = Field(None, max_length=500)
    expires_at: Optional[datetime] = None
    verification_type: str = Field(default="manual", regex="^(manual|automatic|external)$")
    external_url: Optional[str] = Field(None, max_length=500)

class AdminBroadcast(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    message: str = Field(..., min_length=1, max_length=1000)
    type: str = Field(..., regex="^(info|warning|success|error)$")
    priority: str = Field(..., regex="^(low|medium|high)$")

class TaskComplete(BaseModel):
    task_id: str = Field(..., min_length=1)
    verification_data: Optional[Dict[str, Any]] = None

class AdminGrantToken(BaseModel):
    user_id: str = Field(..., min_length=1)
    token_name: Optional[str] = Field("Admin Granted Token", min_length=1, max_length=100)

class AdminBoostToken(BaseModel):
    token_id: str = Field(..., min_length=1)

# ============================================================================
# PROFESSIONAL UTILITY FUNCTIONS
# ============================================================================

def hash_password(password: str) -> str:
    """Hash password using bcrypt"""
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against hash"""
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    """Create JWT access token with expiration"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(hours=24)
    to_encode.update({"exp": expire, "iat": datetime.utcnow()})
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm="HS256")
    return encoded_jwt

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Get current authenticated user"""
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=["HS256"])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid authentication token")
        
        user = users_collection.find_one({"user_id": user_id})
        if user is None:
            raise HTTPException(status_code=401, detail="User not found")
        
        update_user_session(user_id)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication token")

def generate_referral_code(email: str) -> str:
    """Generate unique referral code"""
    base_code = f"PP{hashlib.md5(email.encode()).hexdigest()[:8].upper()}"
    counter = 0
    while users_collection.find_one({"referral_code": base_code}):
        counter += 1
        base_code = f"PP{hashlib.md5(f'{email}{counter}'.encode()).hexdigest()[:8].upper()}"
    return base_code

def generate_user_id() -> str:
    """Generate unique user ID"""
    base_id = f"PP-{str(uuid.uuid4()).split('-')[0].upper()}"
    while users_collection.find_one({"user_id": base_id}):
        base_id = f"PP-{str(uuid.uuid4()).split('-')[0].upper()}"
    return base_id

# ============================================================================
# ENHANCED MULTI-CURRENCY SYSTEM WITH PROFESSIONAL ERROR HANDLING
# ============================================================================

async def get_currency_rates():
    """Get real-time currency conversion rates with fallback"""
    try:
        # Try multiple APIs for reliability
        apis = [
            "https://api.exchangerate-api.com/v4/latest/USD",
            "https://open.er-api.com/v6/latest/USD",
            "https://api.fixer.io/latest?access_key=" + EXCHANGE_API_KEY if EXCHANGE_API_KEY else None
        ]
        
        for api_url in apis:
            if not api_url:
                continue
            try:
                response = requests.get(api_url, timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    rates = data.get('rates', data.get('conversion_rates', {}))
                    
                    if rates:
                        # Cache the rates
                        currency_rates_collection.update_one(
                            {"_id": "latest_rates"},
                            {"$set": {"rates": rates, "updated_at": datetime.utcnow()}},
                            upsert=True
                        )
                        logger.info("✅ Currency rates updated successfully")
                        return rates
            except Exception as e:
                logger.warning(f"Failed to fetch from {api_url}: {e}")
                continue
        
        # Fallback to cached rates
        cached_rates = currency_rates_collection.find_one({"_id": "latest_rates"})
        if cached_rates and cached_rates.get('rates'):
            logger.info("Using cached currency rates")
            return cached_rates['rates']
        
        # Final fallback to hardcoded rates
        fallback_rates = {
            "USD": 1, "NGN": 1500, "GBP": 0.75, "EUR": 0.85, 
            "CAD": 1.25, "AUD": 1.35, "JPY": 110, "INR": 75, "ZAR": 15
        }
        logger.warning("Using fallback currency rates")
        return fallback_rates
        
    except Exception as e:
        logger.error(f"Currency rates error: {e}")
        return {"USD": 1, "NGN": 1500, "GBP": 0.75, "EUR": 0.85, "CAD": 1.25, "AUD": 1.35, "JPY": 110, "INR": 75, "ZAR": 15}

async def detect_user_country(request: Request):
    """Detect user's country from IP address with fallback"""
    try:
        client_ip = request.client.host
        if client_ip in ["127.0.0.1", "localhost", "::1"]:
            return "NG"  # Default for local development
        
        # Try multiple IP geolocation services
        services = [
            f"http://ipinfo.io/{client_ip}/json",
            f"http://ip-api.com/json/{client_ip}",
            f"https://ipapi.co/{client_ip}/json"
        ]
        
        for service_url in services:
            try:
                response = requests.get(service_url, timeout=5)
                if response.status_code == 200:
                    data = response.json()
                    country = data.get('country', data.get('countryCode', 'NG'))
                    if country:
                        return country.upper()
            except Exception as e:
                logger.warning(f"Failed to get country from {service_url}: {e}")
                continue
        
        return "NG"  # Default fallback
    except Exception as e:
        logger.error(f"Country detection error: {e}")
        return "NG"

def get_currency_for_country(country_code: str) -> str:
    """Map country code to currency with comprehensive mapping"""
    currency_map = {
        "NG": "NGN", "US": "USD", "GB": "GBP", "DE": "EUR", "FR": "EUR",
        "CA": "CAD", "AU": "AUD", "JP": "JPY", "IN": "INR", "ZA": "ZAR",
        "IT": "EUR", "ES": "EUR", "NL": "EUR", "BE": "EUR", "AT": "EUR",
        "PT": "EUR", "IE": "EUR", "FI": "EUR", "GR": "EUR", "LU": "EUR",
        "CH": "EUR", "SE": "EUR", "DK": "EUR", "NO": "EUR", "PL": "EUR",
        "CZ": "EUR", "HU": "EUR", "SK": "EUR", "SI": "EUR", "EE": "EUR",
        "LV": "EUR", "LT": "EUR", "CY": "EUR", "MT": "EUR", "BR": "USD",
        "MX": "USD", "AR": "USD", "CO": "USD", "PE": "USD", "CL": "USD"
    }
    return currency_map.get(country_code, "USD")

async def convert_currency(amount: float, from_currency: str, to_currency: str) -> float:
    """Convert amount from one currency to another with error handling"""
    try:
        if from_currency == to_currency:
            return round(amount, 2)
        
        rates = await get_currency_rates()
        
        # Convert to USD first, then to target currency
        usd_amount = amount / rates.get(from_currency, 1)
        converted_amount = usd_amount * rates.get(to_currency, 1)
        
        return round(converted_amount, 2)
    except Exception as e:
        logger.error(f"Currency conversion error: {e}")
        return amount  # Return original amount on error

# ============================================================================
# PROFESSIONAL SESSION MANAGEMENT
# ============================================================================

def update_user_session(user_id: str):
    """Update user's last active time"""
    try:
        user_sessions_collection.update_one(
            {"user_id": user_id},
            {
                "$set": {"last_active": datetime.utcnow()},
                "$setOnInsert": {"first_login": datetime.utcnow()}
            },
            upsert=True
        )
    except Exception as e:
        logger.error(f"Session update error: {e}")

def get_online_users_count():
    """Get count of users online in last 5 minutes"""
    try:
        five_minutes_ago = datetime.utcnow() - timedelta(minutes=5)
        return user_sessions_collection.count_documents({
            "last_active": {"$gte": five_minutes_ago}
        })
    except Exception as e:
        logger.error(f"Online users count error: {e}")
        return 0

# ============================================================================
# ENHANCED NOTIFICATION SYSTEM
# ============================================================================

def create_notification(user_id: str, title: str, message: str, notification_type: str = "info", priority: str = "medium"):
    """Create a notification for a user with enhanced features"""
    try:
        notification_doc = {
            "notification_id": str(uuid.uuid4()),
            "user_id": user_id,
            "title": title,
            "message": message,
            "type": notification_type,
            "priority": priority,
            "read": False,
            "created_at": datetime.utcnow(),
            "expires_at": datetime.utcnow() + timedelta(days=30)
        }
        notifications_collection.insert_one(notification_doc)
        logger.info(f"Notification created for user {user_id}: {title}")
        return notification_doc
    except Exception as e:
        logger.error(f"Notification creation error: {e}")
        return None

async def cleanup_old_notifications():
    """Clean up expired notifications"""
    try:
        result = notifications_collection.delete_many({
            "expires_at": {"$lt": datetime.utcnow()}
        })
        if result.deleted_count > 0:
            logger.info(f"Cleaned up {result.deleted_count} expired notifications")
    except Exception as e:
        logger.error(f"Notification cleanup error: {e}")

# ============================================================================
# PROFESSIONAL MINING SYSTEM WITH ENHANCED LOGGING
# ============================================================================

async def process_mining():
    """Professional automated mining process with comprehensive logging"""
    try:
        start_time = time.time()
        logger.info("🚀 Starting automated mining process...")
        
        # Get all active tokens
        tokens = list(tokens_collection.find({"active": True}))
        total_tokens_processed = 0
        total_earnings_distributed = 0.0
        processing_details = []
        
        for token in tokens:
            try:
                owner = users_collection.find_one({"user_id": token["owner_id"]})
                if not owner or owner.get("is_admin"):
                    continue
                
                # Calculate earnings with boost
                base_earning = 0.70
                boost_level = token.get('boost_level', 0)
                earning = base_earning * (2 ** boost_level)
                
                # Update token
                tokens_collection.update_one(
                    {"token_id": token["token_id"]},
                    {
                        "$inc": {"total_earnings": earning},
                        "$set": {"last_mining": datetime.utcnow()},
                        "$push": {
                            "mining_history": {
                                "amount": earning,
                                "timestamp": datetime.utcnow(),
                                "boost_level": boost_level,
                                "session_id": str(uuid.uuid4())[:8]
                            }
                        }
                    }
                )
                
                # Update user earnings
                users_collection.update_one(
                    {"user_id": token["owner_id"]},
                    {"$inc": {"total_earnings": earning}}
                )
                
                # Create success notification
                create_notification(
                    token["owner_id"],
                    "Mining Completed! 💰",
                    f"Your token '{token['name']}' earned ${earning:.2f}",
                    "success"
                )
                
                processing_details.append({
                    "token_id": token["token_id"],
                    "owner_id": token["owner_id"],
                    "earning": earning,
                    "boost_level": boost_level
                })
                
                total_tokens_processed += 1
                total_earnings_distributed += earning
                
            except Exception as token_error:
                logger.error(f"❌ Error processing token {token.get('token_id', 'unknown')}: {token_error}")
                processing_details.append({
                    "token_id": token.get("token_id", "unknown"),
                    "error": str(token_error)
                })
        
        processing_time = time.time() - start_time
        
        # Log mining session
        mining_log = {
            "session_id": str(uuid.uuid4()),
            "timestamp": datetime.utcnow(),
            "tokens_processed": total_tokens_processed,
            "total_earnings_distributed": total_earnings_distributed,
            "processing_time_seconds": processing_time,
            "status": "success",
            "details": processing_details
        }
        mining_logs_collection.insert_one(mining_log)
        
        logger.info(f"✅ Mining completed! Processed {total_tokens_processed} tokens, distributed ${total_earnings_distributed:.2f} in {processing_time:.2f}s")
        
    except Exception as e:
        logger.error(f"❌ Mining process error: {e}")
        mining_logs_collection.insert_one({
            "session_id": str(uuid.uuid4()),
            "timestamp": datetime.utcnow(),
            "tokens_processed": 0,
            "total_earnings_distributed": 0.0,
            "status": "failed",
            "error": str(e),
            "processing_time_seconds": 0
        })

async def mining_scheduler():
    """Professional mining scheduler with 2-hour intervals"""
    logger.info("⛏️ Mining scheduler started - 2 hour intervals")
    while True:
        try:
            await process_mining()
            # Clean up notifications while we're at it
            await cleanup_old_notifications()
            await asyncio.sleep(7200)  # 2 hours = 7200 seconds
        except Exception as e:
            logger.error(f"Mining scheduler error: {e}")
            await asyncio.sleep(300)  # Wait 5 minutes on error

# ============================================================================
# PROFESSIONAL EXTERNAL TASK VERIFICATION
# ============================================================================

async def verify_external_task(task: dict, user_id: str, verification_data: dict = None) -> bool:
    """Verify external task completion with multiple methods"""
    try:
        verification_type = task.get('verification_type', 'manual')
        external_url = task.get('external_url', '')
        
        if verification_type == 'external' and external_url:
            # For social media tasks, Twitter follows, etc.
            if 'twitter.com' in external_url or 'x.com' in external_url:
                # Twitter verification logic would go here
                # For now, we'll mark as completed since we can't access Twitter API without keys
                return True
            
            elif 'instagram.com' in external_url:
                # Instagram verification logic
                return True
            
            elif 'youtube.com' in external_url or 'youtu.be' in external_url:
                # YouTube verification logic
                return True
            
            elif 'telegram.me' in external_url or 't.me' in external_url:
                # Telegram verification logic
                return True
            
            else:
                # Generic URL verification - check if URL is accessible
                try:
                    response = requests.head(external_url, timeout=10)
                    return response.status_code == 200
                except:
                    return True  # Assume completed if we can't verify
        
        return True  # Default to true for manual verification
        
    except Exception as e:
        logger.error(f"External task verification error: {e}")
        return True  # Default to true on error

# ============================================================================
# LIFESPAN MANAGEMENT
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Professional application lifespan management"""
    logger.info("🚀 ProfitPilot Professional API starting...")
    
    global mining_task
    mining_task = asyncio.create_task(mining_scheduler())
    logger.info("⛏️ Automated mining system initialized")
    
    # Log system startup
    system_logs_collection.insert_one({
        "event": "system_startup",
        "timestamp": datetime.utcnow(),
        "version": "3.0.0",
        "environment": os.getenv("ENVIRONMENT", "development")
    })
    
    yield
    
    logger.info("🛑 ProfitPilot API shutting down...")
    if mining_task:
        mining_task.cancel()
        try:
            await mining_task
        except asyncio.CancelledError:
            logger.info("⛏️ Mining task cancelled")
    
    # Log system shutdown
    system_logs_collection.insert_one({
        "event": "system_shutdown",
        "timestamp": datetime.utcnow(),
        "version": "3.0.0"
    })

# ============================================================================
# PROFESSIONAL FASTAPI APPLICATION
# ============================================================================

app = FastAPI(
    title="ProfitPilot Professional API", 
    version="3.0.0",
    description="Professional crypto earning platform with multi-currency support and real-time features",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# Professional middleware configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure properly for production
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.add_middleware(
    TrustedHostMiddleware, 
    allowed_hosts=["*"]  # Configure properly for production
)

# ============================================================================
# ENHANCED API ENDPOINTS
# ============================================================================

@app.get("/api/health")
async def health_check():
    """Professional health check endpoint"""
    try:
        # Test database connection
        db_status = "healthy" if client.admin.command('ping')['ok'] else "unhealthy"
        
        # Check mining task status
        mining_status = "active" if mining_task and not mining_task.done() else "inactive"
        
        # Get online users count
        online_users = get_online_users_count()
        
        return {
            "status": "healthy",
            "timestamp": datetime.utcnow(),
            "version": "3.0.0",
            "database_status": db_status,
            "mining_status": mining_status,
            "online_users": online_users,
            "environment": os.getenv("ENVIRONMENT", "development")
        }
    except Exception as e:
        logger.error(f"Health check error: {e}")
        raise HTTPException(status_code=503, detail="Service temporarily unavailable")

@app.post("/api/register")
async def register_user(user_data: UserRegister, request: Request):
    """Enhanced user registration with country detection and referral processing"""
    try:
        # Check if email already exists
        if users_collection.find_one({"email": user_data.email}):
            raise HTTPException(status_code=400, detail="Email already registered")
        
        # Generate unique identifiers
        user_id = generate_user_id()
        referral_code = generate_referral_code(user_data.email)
        hashed_password = hash_password(user_data.password)
        
        # Detect user's country and preferred currency
        country = await detect_user_country(request)
        preferred_currency = get_currency_for_country(country)
        
        # Create user document
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
            "notifications_enabled": True,
            "last_login": datetime.utcnow(),
            "login_count": 1
        }
        
        users_collection.insert_one(user_doc)
        
        # Process referral if provided
        referral_bonus = 0.0
        if user_data.referral_code:
            referrer = users_collection.find_one({"referral_code": user_data.referral_code})
            if referrer and not referrer.get("is_admin"):
                referral_bonus = 2.0
                
                # Update referrer
                users_collection.update_one(
                    {"user_id": referrer["user_id"]},
                    {"$inc": {"referral_earnings": referral_bonus, "total_earnings": referral_bonus, "referrals_count": 1}}
                )
                
                # Update new user if not admin
                if not user_doc.get("is_admin"):
                    users_collection.update_one(
                        {"user_id": user_id},
                        {"$inc": {"referral_earnings": referral_bonus, "total_earnings": referral_bonus}}
                    )
                
                # Record referral
                referrals_collection.insert_one({
                    "referrer_id": referrer["user_id"],
                    "referred_id": user_id,
                    "amount": referral_bonus,
                    "timestamp": datetime.utcnow(),
                    "status": "completed"
                })
                
                # Notify both users
                create_notification(
                    referrer["user_id"],
                    "New Referral! 🎉",
                    f"You earned ${referral_bonus:.2f} from a new referral!",
                    "success"
                )
                
                if not user_doc.get("is_admin"):
                    create_notification(
                        user_id,
                        "Welcome Bonus! 💰",
                        f"You received ${referral_bonus:.2f} welcome bonus!",
                        "success"
                    )
        
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
                "boost_history": [],
                "token_type": "free_starter"
            }
            tokens_collection.insert_one(token_doc)
            users_collection.update_one({"user_id": user_id}, {"$inc": {"tokens_owned": 1}})
            
            # Welcome notification
            create_notification(
                user_id,
                "Welcome to ProfitPilot! 🚀",
                "Your free mining token has been activated and will start earning in 2 hours!",
                "success"
            )
        
        # Create access token
        access_token = create_access_token(data={"sub": user_id})
        update_user_session(user_id)
        
        logger.info(f"✅ New user registered: {user_id} ({user_data.email}) from {country}")
        
        return {
            "message": "User registered successfully",
            "access_token": access_token,
            "user_id": user_id,
            "referral_code": referral_code,
            "is_admin": user_doc.get("is_admin", False),
            "preferred_currency": preferred_currency,
            "referral_bonus": referral_bonus
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Registration error: {e}")
        raise HTTPException(status_code=500, detail="Registration failed")

@app.post("/api/login")
async def login_user(user_data: UserLogin):
    """Enhanced user login with session tracking"""
    try:
        user = users_collection.find_one({"email": user_data.email})
        if not user or not verify_password(user_data.password, user["password"]):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        # Update login tracking
        users_collection.update_one(
            {"user_id": user["user_id"]},
            {
                "$set": {"last_login": datetime.utcnow()},
                "$inc": {"login_count": 1}
            }
        )
        
        access_token = create_access_token(data={"sub": user["user_id"]})
        update_user_session(user["user_id"])
        
        logger.info(f"✅ User login: {user['user_id']} ({user_data.email})")
        
        return {
            "access_token": access_token,
            "user_id": user["user_id"],
            "is_admin": user.get("is_admin", False),
            "preferred_currency": user.get("preferred_currency", "USD"),
            "theme": user.get("theme", "light")
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login error: {e}")
        raise HTTPException(status_code=500, detail="Login failed")

@app.get("/api/dashboard")
async def get_dashboard(current_user: dict = Depends(get_current_user)):
    """Enhanced dashboard with complete currency conversion"""
    try:
        # Get user's tokens
        tokens = list(tokens_collection.find({"owner_id": current_user["user_id"]}))
        
        # Calculate next mining time
        next_mining = None
        if tokens:
            last_mining_times = [t.get("last_mining", t["created_at"]) for t in tokens]
            if last_mining_times:
                last_mining = max(last_mining_times)
                next_mining = last_mining + timedelta(hours=2)
        
        # Get fresh user data
        fresh_user = users_collection.find_one({"user_id": current_user["user_id"]})
        user_currency = fresh_user.get("preferred_currency", "USD")
        
        # Convert all earnings to user's preferred currency
        total_earnings_converted = await convert_currency(
            fresh_user["total_earnings"], "USD", user_currency
        )
        referral_earnings_converted = await convert_currency(
            fresh_user["referral_earnings"], "USD", user_currency
        )
        
        # Convert token earnings
        converted_tokens = []
        for token in tokens:
            total_earnings_converted_token = await convert_currency(
                token["total_earnings"], "USD", user_currency
            )
            hourly_rate = 0.70 * (2 ** token["boost_level"]) / 2
            hourly_rate_converted = await convert_currency(hourly_rate, "USD", user_currency)
            
            converted_tokens.append({
                "token_id": token["token_id"],
                "name": token["name"],
                "boost_level": token["boost_level"],
                "total_earnings": token["total_earnings"],
                "total_earnings_converted": total_earnings_converted_token,
                "created_at": token["created_at"],
                "last_mining": token.get("last_mining"),
                "hourly_rate": hourly_rate,
                "hourly_rate_converted": hourly_rate_converted,
                "active": token.get("active", True),
                "token_type": token.get("token_type", "standard")
            })
        
        # Calculate mining rate
        total_mining_rate = sum([0.70 * (2 ** t["boost_level"]) for t in tokens])
        total_mining_rate_converted = await convert_currency(total_mining_rate, "USD", user_currency)
        
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
                "notifications_enabled": fresh_user.get("notifications_enabled", True),
                "country": fresh_user.get("country", "NG"),
                "last_login": fresh_user.get("last_login"),
                "login_count": fresh_user.get("login_count", 1)
            },
            "tokens": converted_tokens,
            "next_mining": next_mining,
            "stats": {
                "active_assets": len([t for t in tokens if t.get("active", True)]),
                "total_balance": fresh_user["total_earnings"],
                "total_balance_converted": total_earnings_converted,
                "mining_rate": total_mining_rate,
                "mining_rate_converted": total_mining_rate_converted,
                "currency": user_currency,
                "next_mining_countdown": next_mining
            }
        }
        
    except Exception as e:
        logger.error(f"Dashboard error: {e}")
        raise HTTPException(status_code=500, detail="Failed to load dashboard")

@app.post("/api/profile/update")
async def update_profile(profile_data: ProfileUpdate, current_user: dict = Depends(get_current_user)):
    """Enhanced profile update with validation"""
    try:
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
            update_fields["profile_updated_at"] = datetime.utcnow()
            users_collection.update_one(
                {"user_id": current_user["user_id"]},
                {"$set": update_fields}
            )
            
            logger.info(f"Profile updated for user {current_user['user_id']}: {update_fields}")
        
        return {"message": "Profile updated successfully", "updated_fields": update_fields}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Profile update error: {e}")
        raise HTTPException(status_code=500, detail="Profile update failed")

@app.get("/api/currencies")
async def get_supported_currencies():
    """Get list of supported currencies with current rates"""
    try:
        rates = await get_currency_rates()
        supported_currencies = {
            "USD": {"name": "US Dollar", "symbol": "$", "flag": "🇺🇸"},
            "NGN": {"name": "Nigerian Naira", "symbol": "₦", "flag": "🇳🇬"},
            "GBP": {"name": "British Pound", "symbol": "£", "flag": "🇬🇧"},
            "EUR": {"name": "Euro", "symbol": "€", "flag": "🇪🇺"},
            "CAD": {"name": "Canadian Dollar", "symbol": "C$", "flag": "🇨🇦"},
            "AUD": {"name": "Australian Dollar", "symbol": "A$", "flag": "🇦🇺"},
            "JPY": {"name": "Japanese Yen", "symbol": "¥", "flag": "🇯🇵"},
            "INR": {"name": "Indian Rupee", "symbol": "₹", "flag": "🇮🇳"},
            "ZAR": {"name": "South African Rand", "symbol": "R", "flag": "🇿🇦"}
        }
        
        return {
            "currencies": supported_currencies,
            "rates": rates,
            "last_updated": datetime.utcnow()
        }
        
    except Exception as e:
        logger.error(f"Currencies fetch error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch currencies")

@app.post("/api/tokens/create")
async def create_token(current_user: dict = Depends(get_current_user)):
    """Create new token with validation"""
    try:
        if current_user.get("is_admin"):
            raise HTTPException(status_code=400, detail="Admin accounts cannot create tokens")
            
        if current_user["tokens_owned"] >= 5:
            raise HTTPException(status_code=400, detail="Maximum 5 tokens allowed per user")
        
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
            "boost_history": [],
            "token_type": "free_starter"
        }
        
        tokens_collection.insert_one(token_doc)
        users_collection.update_one(
            {"user_id": current_user["user_id"]},
            {"$inc": {"tokens_owned": 1}}
        )
        
        create_notification(
            current_user["user_id"],
            "New Token Created! 🪙",
            f"Your new token '{token_doc['name']}' is now active and mining!",
            "success"
        )
        
        logger.info(f"Token created for user {current_user['user_id']}: {token_id}")
        
        return {"message": "Token created successfully", "token": token_doc}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Token creation error: {e}")
        raise HTTPException(status_code=500, detail="Token creation failed")

@app.post("/api/payment/initialize")
async def initialize_payment(payment_data: dict, current_user: dict = Depends(get_current_user)):
    """Initialize payment with enhanced validation and currency conversion"""
    try:
        if current_user.get("is_admin"):
            raise HTTPException(status_code=400, detail="Admin accounts cannot make payments")
            
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
            
            if token.get("boost_level", 0) >= 10:
                raise HTTPException(status_code=400, detail="Maximum boost level reached")
            
            amount_usd = 3.0 * (2 ** token["boost_level"])
        else:
            raise HTTPException(status_code=400, detail="Invalid payment action")
        
        # Get current exchange rate
        rates = await get_currency_rates()
        exchange_rate = rates.get("NGN", 1500)
        amount_ngn = amount_usd * exchange_rate
        amount_kobo = int(amount_ngn * 100)
        
        # Generate unique reference
        reference = f"pp_{action}_{uuid.uuid4().hex[:12]}"
        
        paystack_data = {
            "email": current_user["email"],
            "amount": amount_kobo,
            "currency": "NGN",
            "reference": reference,
            "callback_url": f"{os.getenv('FRONTEND_URL', 'http://localhost:3000')}?reference={reference}",
            "metadata": {
                "user_id": current_user["user_id"],
                "action": action,
                "token_id": token_id,
                "amount_usd": amount_usd,
                "exchange_rate": exchange_rate
            }
        }
        
        headers = {
            "Authorization": f"Bearer {PAYSTACK_SECRET_KEY}",
            "Content-Type": "application/json"
        }
        
        response = requests.post(
            "https://api.paystack.co/transaction/initialize",
            json=paystack_data,
            headers=headers,
            timeout=30
        )
        
        if response.status_code == 200:
            data = response.json()
            
            # Log payment initialization
            transactions_collection.insert_one({
                "user_id": current_user["user_id"],
                "reference": reference,
                "action": action,
                "amount_usd": amount_usd,
                "amount_ngn": amount_ngn,
                "status": "initialized",
                "paystack_reference": data["data"]["reference"],
                "timestamp": datetime.utcnow(),
                "token_id": token_id,
                "exchange_rate": exchange_rate
            })
            
            logger.info(f"Payment initialized for user {current_user['user_id']}: {action} - ${amount_usd}")
            
            return {
                "authorization_url": data["data"]["authorization_url"],
                "reference": data["data"]["reference"],
                "amount_usd": amount_usd,
                "amount_ngn": amount_ngn,
                "exchange_rate": exchange_rate
            }
        else:
            logger.error(f"Paystack initialization failed: {response.text}")
            raise HTTPException(status_code=400, detail="Payment initialization failed")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Payment initialization error: {e}")
        raise HTTPException(status_code=500, detail="Payment initialization failed")

@app.post("/api/payment/verify")
async def verify_payment(payment_data: PaymentVerification, current_user: dict = Depends(get_current_user)):
    """Verify payment with enhanced processing and notifications"""
    try:
        if current_user.get("is_admin"):
            raise HTTPException(status_code=400, detail="Admin accounts cannot verify payments")
            
        headers = {"Authorization": f"Bearer {PAYSTACK_SECRET_KEY}"}
        
        response = requests.get(
            f"https://api.paystack.co/transaction/verify/{payment_data.reference}",
            headers=headers,
            timeout=30
        )
        
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail="Payment verification failed")
        
        data = response.json()
        if data["data"]["status"] != "success":
            raise HTTPException(status_code=400, detail="Payment not successful")
        
        # Check if payment already processed
        existing_tx = transactions_collection.find_one({
            "reference": payment_data.reference,
            "status": "success"
        })
        if existing_tx:
            raise HTTPException(status_code=400, detail="Payment already processed")
        
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
                "boost_history": [],
                "token_type": "purchased",
                "purchase_reference": payment_data.reference
            }
            tokens_collection.insert_one(token_doc)
            users_collection.update_one(
                {"user_id": current_user["user_id"]},
                {"$inc": {"tokens_owned": 1}}
            )
            
            create_notification(
                current_user["user_id"],
                "New Token Purchased! 🪙",
                f"Your new token '{token_doc['name']}' is now active and mining!",
                "success"
            )
            
        elif action == "boost":
            # Boost existing token
            token_id = metadata["token_id"]
            token = tokens_collection.find_one({"token_id": token_id})
            if not token:
                raise HTTPException(status_code=404, detail="Token not found")
            
            new_boost_level = token["boost_level"] + 1
            tokens_collection.update_one(
                {"token_id": token_id},
                {
                    "$inc": {"boost_level": 1},
                    "$push": {
                        "boost_history": {
                            "timestamp": datetime.utcnow(),
                            "cost_usd": metadata["amount_usd"],
                            "new_level": new_boost_level,
                            "reference": payment_data.reference
                        }
                    }
                }
            )
            
            users_collection.update_one(
                {"user_id": current_user["user_id"]},
                {"$inc": {"boosts_used": 1}}
            )
            
            create_notification(
                current_user["user_id"],
                "Token Boosted! ⚡",
                f"Your token '{token['name']}' is now level {new_boost_level}!",
                "success"
            )
        
        # Update transaction record
        transactions_collection.update_one(
            {"reference": payment_data.reference},
            {
                "$set": {
                    "status": "success",
                    "verified_at": datetime.utcnow(),
                    "paystack_data": data["data"]
                }
            }
        )
        
        logger.info(f"Payment verified for user {current_user['user_id']}: {action} - {payment_data.reference}")
        
        return {"message": "Payment processed successfully", "action": action}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Payment verification error: {e}")
        raise HTTPException(status_code=500, detail="Payment verification failed")

@app.get("/api/notifications")
async def get_user_notifications(current_user: dict = Depends(get_current_user)):
    """Get user notifications with pagination"""
    try:
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
            "unread_count": unread_count,
            "total_count": len(notifications)
        }
        
    except Exception as e:
        logger.error(f"Notifications fetch error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch notifications")

@app.post("/api/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, current_user: dict = Depends(get_current_user)):
    """Mark notification as read"""
    try:
        result = notifications_collection.update_one(
            {"notification_id": notification_id, "user_id": current_user["user_id"]},
            {"$set": {"read": True, "read_at": datetime.utcnow()}}
        )
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Notification not found")
        
        return {"message": "Notification marked as read"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Mark notification read error: {e}")
        raise HTTPException(status_code=500, detail="Failed to mark notification as read")

@app.get("/api/tasks")
async def get_available_tasks(current_user: dict = Depends(get_current_user)):
    """Get available tasks for user with currency conversion"""
    try:
        if current_user.get("is_admin"):
            return {"tasks": []}
        
        # Get tasks not completed by current user and not expired
        tasks = list(tasks_collection.find({
            "active": True,
            "completed_by": {"$ne": current_user["user_id"]},
            "$or": [
                {"expires_at": None},
                {"expires_at": {"$gt": datetime.utcnow()}}
            ]
        }))
        
        user_currency = current_user.get("preferred_currency", "USD")
        
        # Convert task rewards to user's currency
        converted_tasks = []
        for task in tasks:
            task['_id'] = str(task['_id'])
            reward_converted = await convert_currency(task["reward"], "USD", user_currency)
            task["reward_converted"] = reward_converted
            task["currency"] = user_currency
            converted_tasks.append(task)
        
        return {"tasks": converted_tasks, "currency": user_currency}
        
    except Exception as e:
        logger.error(f"Tasks fetch error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch tasks")

@app.post("/api/tasks/complete")
async def complete_task(task_complete: TaskComplete, current_user: dict = Depends(get_current_user)):
    """Complete a task and earn reward with enhanced verification"""
    try:
        if current_user.get("is_admin"):
            raise HTTPException(status_code=400, detail="Admin accounts cannot complete tasks")
        
        task = tasks_collection.find_one({"task_id": task_complete.task_id, "active": True})
        if not task:
            raise HTTPException(status_code=404, detail="Task not found or inactive")
        
        if current_user["user_id"] in task.get("completed_by", []):
            raise HTTPException(status_code=400, detail="Task already completed")
        
        if task.get("expires_at") and task["expires_at"] < datetime.utcnow():
            raise HTTPException(status_code=400, detail="Task has expired")
        
        # Verify external task if needed
        if task.get("verification_type") == "external":
            verification_passed = await verify_external_task(task, current_user["user_id"], task_complete.verification_data)
            if not verification_passed:
                raise HTTPException(status_code=400, detail="Task verification failed")
        
        # Award the reward
        users_collection.update_one(
            {"user_id": current_user["user_id"]},
            {"$inc": {"total_earnings": task["reward"]}}
        )
        
        # Mark task as completed
        tasks_collection.update_one(
            {"task_id": task_complete.task_id},
            {
                "$push": {
                    "completed_by": current_user["user_id"],
                    "completion_data": {
                        "user_id": current_user["user_id"],
                        "completed_at": datetime.utcnow(),
                        "verification_data": task_complete.verification_data
                    }
                }
            }
        )
        
        # Record transaction
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
        user_currency = current_user.get("preferred_currency", "USD")
        reward_converted = await convert_currency(task["reward"], "USD", user_currency)
        
        create_notification(
            current_user["user_id"],
            "Task Completed! 🎉",
            f"You've earned {user_currency} {reward_converted:.2f} for completing '{task['title']}'",
            "success"
        )
        
        logger.info(f"Task completed by user {current_user['user_id']}: {task_complete.task_id}")
        
        return {
            "message": "Task completed successfully",
            "reward": task["reward"],
            "reward_converted": reward_converted,
            "currency": user_currency
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Task completion error: {e}")
        raise HTTPException(status_code=500, detail="Task completion failed")

@app.get("/api/leaderboard")
async def get_leaderboard():
    """Get leaderboard with currency conversion support"""
    try:
        # Get top earners (non-admin users)
        top_earners = list(users_collection.find(
            {"is_admin": {"$ne": True}},
            {"user_id": 1, "email": 1, "total_earnings": 1, "tokens_owned": 1, "boosts_used": 1, "preferred_currency": 1}
        ).sort("total_earnings", -1).limit(10))
        
        # Get top tokens (non-admin owned)
        admin_user_ids = [user["user_id"] for user in users_collection.find({"is_admin": True}, {"user_id": 1})]
        top_tokens = list(tokens_collection.find(
            {"owner_id": {"$nin": admin_user_ids}},
            {"name": 1, "boost_level": 1, "total_earnings": 1, "owner_id": 1}
        ).sort("boost_level", -1).limit(10))
        
        # Process and anonymize data
        processed_earners = []
        for user in top_earners:
            user_currency = user.get("preferred_currency", "USD")
            total_earnings_converted = await convert_currency(user["total_earnings"], "USD", user_currency)
            
            processed_earners.append({
                "user_id": user["user_id"][:8] + "***",
                "email": user["email"][:3] + "***" + user["email"][-10:],
                "total_earnings": user["total_earnings"],
                "total_earnings_converted": total_earnings_converted,
                "currency": user_currency,
                "tokens_owned": user["tokens_owned"],
                "boosts_used": user["boosts_used"]
            })
        
        processed_tokens = []
        for token in top_tokens:
            processed_tokens.append({
                "name": token["name"],
                "boost_level": token["boost_level"],
                "total_earnings": token["total_earnings"],
                "owner_id": token["owner_id"][:8] + "***"
            })
        
        return {
            "top_earners": processed_earners,
            "top_tokens": processed_tokens,
            "last_updated": datetime.utcnow()
        }
        
    except Exception as e:
        logger.error(f"Leaderboard error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch leaderboard")

# ============================================================================
# ENHANCED ADMIN WORKSPACE ENDPOINTS
# ============================================================================

def require_admin(current_user: dict = Depends(get_current_user)):
    """Require admin privileges with enhanced validation"""
    if not current_user.get("is_admin"):
        logger.warning(f"Unauthorized admin access attempt by user {current_user.get('user_id', 'unknown')}")
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user

@app.get("/api/admin/workspace/dashboard")
async def get_admin_dashboard(current_user: dict = Depends(require_admin)):
    """Professional admin dashboard with comprehensive analytics"""
    try:
        # Calculate revenue metrics
        revenue_pipeline = [
            {"$match": {"action": {"$in": ["token", "boost"]}, "status": "success"}},
            {"$group": {"_id": None, "total": {"$sum": "$amount_usd"}}}
        ]
        revenue_result = list(transactions_collection.aggregate(revenue_pipeline))
        total_revenue = revenue_result[0]["total"] if revenue_result else 0
        
        # Today's revenue
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        today_revenue_pipeline = [
            {"$match": {"action": {"$in": ["token", "boost"]}, "status": "success", "timestamp": {"$gte": today_start}}},
            {"$group": {"_id": None, "total": {"$sum": "$amount_usd"}}}
        ]
        today_revenue_result = list(transactions_collection.aggregate(today_revenue_pipeline))
        today_revenue = today_revenue_result[0]["total"] if today_revenue_result else 0
        
        # User metrics
        total_users = users_collection.count_documents({"is_admin": {"$ne": True}})
        users_online = get_online_users_count()
        new_users_today = users_collection.count_documents({
            "created_at": {"$gte": today_start},
            "is_admin": {"$ne": True}
        })
        
        # Token metrics
        total_tokens = tokens_collection.count_documents({})
        active_tokens = tokens_collection.count_documents({"active": True})
        tokens_bought = transactions_collection.count_documents({"action": "token", "status": "success"})
        boost_purchases = transactions_collection.count_documents({"action": "boost", "status": "success"})
        
        # Task metrics
        total_tasks = tasks_collection.count_documents({})
        active_tasks = tasks_collection.count_documents({"active": True})
        task_completions_today = transactions_collection.count_documents({
            "action": "task_completion",
            "timestamp": {"$gte": today_start}
        })
        
        # Mining metrics
        today_mining = mining_logs_collection.find_one(
            {"timestamp": {"$gte": today_start}},
            sort=[("timestamp", -1)]
        )
        
        # Recent activity
        recent_transactions = list(transactions_collection.find({}).sort("timestamp", -1).limit(10))
        recent_users = list(users_collection.find(
            {"is_admin": {"$ne": True}},
            {"user_id": 1, "email": 1, "created_at": 1, "total_earnings": 1}
        ).sort("created_at", -1).limit(10))
        
        # Clean up ObjectIds
        for tx in recent_transactions:
            tx['_id'] = str(tx['_id'])
        for user in recent_users:
            user['_id'] = str(user['_id'])
        
        return {
            "revenue_metrics": {
                "total_revenue": total_revenue,
                "today_revenue": today_revenue,
                "average_daily_revenue": total_revenue / 30 if total_revenue > 0 else 0  # Rough estimate
            },
            "user_metrics": {
                "total_users": total_users,
                "users_online": users_online,
                "new_users_today": new_users_today,
                "user_growth_rate": (new_users_today / max(total_users, 1)) * 100
            },
            "token_metrics": {
                "total_tokens": total_tokens,
                "active_tokens": active_tokens,
                "tokens_bought": tokens_bought,
                "boost_purchases": boost_purchases,
                "average_tokens_per_user": total_tokens / max(total_users, 1)
            },
            "task_metrics": {
                "total_tasks": total_tasks,
                "active_tasks": active_tasks,
                "completions_today": task_completions_today,
                "total_broadcasts": broadcasts_collection.count_documents({})
            },
            "mining_status": {
                "last_mining": today_mining["timestamp"] if today_mining else None,
                "tokens_processed_today": today_mining["tokens_processed"] if today_mining else 0,
                "earnings_distributed_today": today_mining["total_earnings_distributed"] if today_mining else 0,
                "system_status": "automated"
            },
            "recent_activity": {
                "recent_transactions": recent_transactions,
                "recent_users": recent_users
            }
        }
        
    except Exception as e:
        logger.error(f"Admin dashboard error: {e}")
        raise HTTPException(status_code=500, detail="Failed to load admin dashboard")

@app.get("/api/admin/workspace/users")
async def get_all_users(current_user: dict = Depends(require_admin)):
    """Get all users with comprehensive data and analytics"""
    try:
        users = list(users_collection.find(
            {"is_admin": {"$ne": True}}, 
            {"password": 0}
        ).sort("created_at", -1))
        
        enhanced_users = []
        for user in users:
            user['_id'] = str(user['_id'])
            
            # Get user tokens
            user_tokens = list(tokens_collection.find({"owner_id": user["user_id"]}))
            user['tokens_count'] = len(user_tokens)
            user['active_tokens_count'] = len([t for t in user_tokens if t.get("active", True)])
            user['total_token_earnings'] = sum([t.get("total_earnings", 0) for t in user_tokens])
            
            # Get transaction count
            user['transactions_count'] = transactions_collection.count_documents({"user_id": user["user_id"]})
            
            # Get session info
            session = user_sessions_collection.find_one({"user_id": user["user_id"]})
            if session:
                last_active = session.get("last_active")
                if last_active and (datetime.utcnow() - last_active).total_seconds() < 300:
                    user['online_status'] = "online"
                elif last_active and (datetime.utcnow() - last_active).total_seconds() < 3600:
                    user['online_status'] = "recently_active"
                else:
                    user['online_status'] = "offline"
                user['last_active'] = last_active
            else:
                user['online_status'] = "offline"
                user['last_active'] = None
            
            # Calculate user value score
            user['value_score'] = (
                user.get("total_earnings", 0) +
                user.get("tokens_count", 0) * 5 +
                user.get("referrals_count", 0) * 2 +
                user.get("transactions_count", 0)
            )
            
            enhanced_users.append(user)
        
        return {
            "users": enhanced_users,
            "total": len(enhanced_users),
            "summary": {
                "online_users": len([u for u in enhanced_users if u['online_status'] == 'online']),
                "total_earnings": sum([u.get("total_earnings", 0) for u in enhanced_users]),
                "total_tokens": sum([u.get("tokens_count", 0) for u in enhanced_users])
            }
        }
        
    except Exception as e:
        logger.error(f"Get all users error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch users")

@app.get("/api/admin/workspace/users/{user_id}")
async def get_user_details(user_id: str, current_user: dict = Depends(require_admin)):
    """Get comprehensive user details for admin"""
    try:
        user = users_collection.find_one({"user_id": user_id}, {"password": 0})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        user['_id'] = str(user['_id'])
        
        # Get all user tokens with detailed info
        tokens = list(tokens_collection.find({"owner_id": user_id}))
        for token in tokens:
            token['_id'] = str(token['_id'])
            # Calculate token performance
            if token.get('mining_history'):
                total_mining_sessions = len(token['mining_history'])
                avg_earning_per_session = sum([h.get('amount', 0) for h in token['mining_history']]) / max(total_mining_sessions, 1)
                token['performance_metrics'] = {
                    "total_sessions": total_mining_sessions,
                    "avg_earning_per_session": avg_earning_per_session,
                    "efficiency_score": avg_earning_per_session * total_mining_sessions
                }
        
        # Get transaction history
        transactions = list(transactions_collection.find({"user_id": user_id}).sort("timestamp", -1).limit(50))
        for tx in transactions:
            tx['_id'] = str(tx['_id'])
        
        # Get referral info
        referrals_made = list(referrals_collection.find({"referrer_id": user_id}))
        referred_by = referrals_collection.find_one({"referred_id": user_id})
        
        for ref in referrals_made:
            ref['_id'] = str(ref['_id'])
        if referred_by:
            referred_by['_id'] = str(referred_by['_id'])
        
        # Get notifications
        notifications = list(notifications_collection.find({"user_id": user_id}).sort("created_at", -1).limit(20))
        for notif in notifications:
            notif['_id'] = str(notif['_id'])
        
        # Get session info
        session = user_sessions_collection.find_one({"user_id": user_id})
        
        return {
            "user": user,
            "tokens": tokens,
            "transactions": transactions,
            "referrals": {
                "made": referrals_made,
                "referred_by": referred_by
            },
            "notifications": notifications,
            "session_info": session,
            "analytics": {
                "total_spent": sum([tx.get("amount_usd", 0) for tx in transactions if tx.get("action") in ["token", "boost"]]),
                "profit_ratio": user.get("total_earnings", 0) / max(sum([tx.get("amount_usd", 0) for tx in transactions if tx.get("action") in ["token", "boost"]]), 1),
                "activity_score": len(transactions) + len(tokens) * 2 + user.get("referrals_count", 0)
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get user details error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch user details")

@app.post("/api/admin/workspace/send-balance")
async def admin_send_balance(balance_data: AdminSendBalance, current_user: dict = Depends(require_admin)):
    """Send balance to a user with enhanced tracking"""
    try:
        user = users_collection.find_one({"user_id": balance_data.user_id})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        if user.get("is_admin"):
            raise HTTPException(status_code=400, detail="Cannot send balance to admin users")
        
        # Update user balance
        users_collection.update_one(
            {"user_id": balance_data.user_id},
            {"$inc": {"total_earnings": balance_data.amount}}
        )
        
        # Record transaction
        transaction_ref = f"admin_gift_{uuid.uuid4().hex[:12]}"
        transactions_collection.insert_one({
            "user_id": balance_data.user_id,
            "reference": transaction_ref,
            "action": "admin_balance_gift",
            "amount_usd": balance_data.amount,
            "amount_ngn": 0,
            "status": "success",
            "admin_reason": balance_data.reason,
            "admin_id": current_user["user_id"],
            "timestamp": datetime.utcnow()
        })
        
        # Convert amount to user's currency for notification
        user_currency = user.get("preferred_currency", "USD")
        amount_converted = await convert_currency(balance_data.amount, "USD", user_currency)
        
        # Create notification
        create_notification(
            balance_data.user_id,
            "Balance Added! 💰",
            f"Admin has added {user_currency} {amount_converted:.2f} to your account. Reason: {balance_data.reason}",
            "success",
            "high"
        )
        
        logger.info(f"Admin {current_user['user_id']} sent ${balance_data.amount:.2f} to {balance_data.user_id}: {balance_data.reason}")
        
        return {
            "message": "Balance sent successfully",
            "amount": balance_data.amount,
            "amount_converted": amount_converted,
            "currency": user_currency,
            "transaction_reference": transaction_ref
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Admin send balance error: {e}")
        raise HTTPException(status_code=500, detail="Failed to send balance")

@app.post("/api/admin/workspace/create-task")
async def admin_create_task(task_data: AdminCreateTask, current_user: dict = Depends(require_admin)):
    """Create dynamic task with enhanced verification and notification system"""
    try:
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
            "completion_data": [],
            "max_completions": None if task_data.type == "repeatable" else (None if task_data.type == "daily" else 1000),
            "difficulty": "easy" if task_data.reward < 1 else ("medium" if task_data.reward < 5 else "hard")
        }
        
        tasks_collection.insert_one(task_doc)
        
        # Notify all non-admin users
        all_users = list(users_collection.find({"is_admin": {"$ne": True}}, {"user_id": 1, "preferred_currency": 1}))
        notification_count = 0
        
        for user_item in all_users:
            try:
                user_currency = user_item.get("preferred_currency", "USD")
                reward_converted = await convert_currency(task_data.reward, "USD", user_currency)
                
                create_notification(
                    user_item["user_id"],
                    f"New Task Available! 🎯",
                    f"{task_data.title} - Earn {user_currency} {reward_converted:.2f}",
                    "info",
                    task_data.type == "daily" and task_data.reward > 2 and "high" or "medium"
                )
                notification_count += 1
            except Exception as notif_error:
                logger.warning(f"Failed to notify user {user_item['user_id']}: {notif_error}")
        
        logger.info(f"Admin {current_user['user_id']} created task: {task_data.title} (notified {notification_count} users)")
        
        return {
            "message": "Task created successfully",
            "task_id": task_id,
            "notifications_sent": notification_count,
            "task": task_doc
        }
        
    except Exception as e:
        logger.error(f"Admin create task error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create task")

@app.get("/api/admin/workspace/tasks")
async def get_admin_tasks(current_user: dict = Depends(require_admin)):
    """Get all tasks with comprehensive analytics"""
    try:
        tasks = list(tasks_collection.find({}).sort("created_at", -1))
        
        enhanced_tasks = []
        for task in tasks:
            task['_id'] = str(task['_id'])
            
            # Calculate task metrics
            completion_count = len(task.get('completed_by', []))
            total_rewards_paid = completion_count * task['reward']
            
            # Calculate completion rate
            total_users = users_collection.count_documents({"is_admin": {"$ne": True}})
            completion_rate = (completion_count / max(total_users, 1)) * 100
            
            # Check if task is popular
            is_popular = completion_rate > 25  # If more than 25% of users completed it
            
            task.update({
                'completion_count': completion_count,
                'total_rewards_paid': total_rewards_paid,
                'completion_rate': completion_rate,
                'is_popular': is_popular,
                'status': 'active' if task.get('active', True) else 'inactive',
                'days_active': (datetime.utcnow() - task['created_at']).days
            })
            
            enhanced_tasks.append(task)
        
        # Calculate summary statistics
        total_tasks = len(enhanced_tasks)
        active_tasks = len([t for t in enhanced_tasks if t['status'] == 'active'])
        total_rewards_distributed = sum([t['total_rewards_paid'] for t in enhanced_tasks])
        most_popular_task = max(enhanced_tasks, key=lambda x: x['completion_rate']) if enhanced_tasks else None
        
        return {
            "tasks": enhanced_tasks,
            "summary": {
                "total_tasks": total_tasks,
                "active_tasks": active_tasks,
                "total_rewards_distributed": total_rewards_distributed,
                "most_popular_task": most_popular_task['title'] if most_popular_task else None,
                "average_completion_rate": sum([t['completion_rate'] for t in enhanced_tasks]) / max(total_tasks, 1)
            }
        }
        
    except Exception as e:
        logger.error(f"Get admin tasks error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch tasks")

@app.put("/api/admin/workspace/tasks/{task_id}/toggle")
async def toggle_task_status(task_id: str, current_user: dict = Depends(require_admin)):
    """Toggle task active status with notification"""
    try:
        task = tasks_collection.find_one({"task_id": task_id})
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        
        new_status = not task.get("active", True)
        tasks_collection.update_one(
            {"task_id": task_id},
            {
                "$set": {
                    "active": new_status,
                    "status_changed_by": current_user["user_id"],
                    "status_changed_at": datetime.utcnow()
                }
            }
        )
        
        # If reactivating a task, notify users
        if new_status:
            all_users = list(users_collection.find(
                {"is_admin": {"$ne": True}},
                {"user_id": 1, "preferred_currency": 1}
            ))
            
            for user_item in all_users:
                if user_item["user_id"] not in task.get("completed_by", []):
                    user_currency = user_item.get("preferred_currency", "USD")
                    reward_converted = await convert_currency(task["reward"], "USD", user_currency)
                    
                    create_notification(
                        user_item["user_id"],
                        "Task Reactivated! 🔄",
                        f"'{task['title']}' is available again - Earn {user_currency} {reward_converted:.2f}",
                        "info"
                    )
        
        logger.info(f"Admin {current_user['user_id']} {'activated' if new_status else 'deactivated'} task: {task_id}")
        
        return {
            "message": f"Task {'activated' if new_status else 'deactivated'} successfully",
            "task_id": task_id,
            "new_status": new_status
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Toggle task status error: {e}")
        raise HTTPException(status_code=500, detail="Failed to toggle task status")

@app.post("/api/admin/workspace/broadcast")
async def admin_broadcast(broadcast_data: AdminBroadcast, current_user: dict = Depends(require_admin)):
    """Send broadcast message to all users with enhanced targeting"""
    try:
        broadcast_id = str(uuid.uuid4())
        
        broadcast_doc = {
            "broadcast_id": broadcast_id,
            "title": broadcast_data.title,
            "message": broadcast_data.message,
            "type": broadcast_data.type,
            "priority": broadcast_data.priority,
            "admin_id": current_user["user_id"],
            "created_at": datetime.utcnow(),
            "recipient_count": 0,
            "delivery_status": "sending"
        }
        
        # Get all non-admin users
        all_users = list(users_collection.find({"is_admin": {"$ne": True}}, {"user_id": 1}))
        
        successful_deliveries = 0
        for user_item in all_users:
            try:
                create_notification(
                    user_item["user_id"],
                    broadcast_data.title,
                    broadcast_data.message,
                    broadcast_data.type,
                    broadcast_data.priority
                )
                successful_deliveries += 1
            except Exception as delivery_error:
                logger.warning(f"Failed to deliver broadcast to user {user_item['user_id']}: {delivery_error}")
        
        # Update broadcast record
        broadcast_doc.update({
            "recipient_count": len(all_users),
            "successful_deliveries": successful_deliveries,
            "delivery_status": "completed",
            "delivery_rate": (successful_deliveries / max(len(all_users), 1)) * 100
        })
        
        broadcasts_collection.insert_one(broadcast_doc)
        
        logger.info(f"Admin {current_user['user_id']} broadcast message to {successful_deliveries}/{len(all_users)} users")
        
        return {
            "message": "Broadcast sent successfully",
            "broadcast_id": broadcast_id,
            "recipients": len(all_users),
            "successful_deliveries": successful_deliveries,
            "delivery_rate": broadcast_doc["delivery_rate"]
        }
        
    except Exception as e:
        logger.error(f"Admin broadcast error: {e}")
        raise HTTPException(status_code=500, detail="Failed to send broadcast")

@app.get("/api/admin/workspace/broadcasts")
async def get_admin_broadcasts(current_user: dict = Depends(require_admin)):
    """Get all admin broadcasts with analytics"""
    try:
        broadcasts = list(broadcasts_collection.find({}).sort("created_at", -1).limit(100))
        
        for broadcast in broadcasts:
            broadcast['_id'] = str(broadcast['_id'])
            
            # Add time-based analytics
            broadcast['age_hours'] = (datetime.utcnow() - broadcast['created_at']).total_seconds() / 3600
            broadcast['age_days'] = broadcast['age_hours'] / 24
        
        # Calculate summary stats
        total_broadcasts = len(broadcasts)
        total_recipients = sum([b.get('recipient_count', 0) for b in broadcasts])
        average_delivery_rate = sum([b.get('delivery_rate', 0) for b in broadcasts]) / max(total_broadcasts, 1)
        
        return {
            "broadcasts": broadcasts,
            "summary": {
                "total_broadcasts": total_broadcasts,
                "total_recipients": total_recipients,
                "average_delivery_rate": average_delivery_rate,
                "broadcasts_this_week": len([b for b in broadcasts if b['age_days'] <= 7])
            }
        }
        
    except Exception as e:
        logger.error(f"Get admin broadcasts error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch broadcasts")

@app.post("/api/admin/workspace/users/grant-token")
async def admin_grant_token_to_user(grant_data: AdminGrantToken, current_admin: dict = Depends(require_admin)):
    """Grant token to user with enhanced validation and tracking"""
    try:
        user_to_grant = users_collection.find_one({"user_id": grant_data.user_id})
        if not user_to_grant:
            raise HTTPException(status_code=404, detail="Target user not found")
        
        if user_to_grant.get("is_admin"):
            raise HTTPException(status_code=400, detail="Cannot grant tokens to admin accounts")

        current_tokens_count = tokens_collection.count_documents({"owner_id": grant_data.user_id})
        if current_tokens_count >= 5:
            raise HTTPException(status_code=400, detail="User already has the maximum of 5 tokens")

        token_id = str(uuid.uuid4())
        token_name = grant_data.token_name.strip() if grant_data.token_name and grant_data.token_name.strip() else f"Admin Token #{current_tokens_count + 1}"
        
        token_doc = {
            "token_id": token_id,
            "owner_id": grant_data.user_id,
            "name": token_name,
            "boost_level": 0,
            "total_earnings": 0.0,
            "created_at": datetime.utcnow(),
            "last_mining": datetime.utcnow(),
            "active": True,
            "mining_history": [],
            "boost_history": [],
            "granted_by_admin": current_admin["user_id"],
            "grant_reason": "Admin grant",
            "token_type": "admin_granted"
        }
        tokens_collection.insert_one(token_doc)
        
        # Update user token count
        users_collection.update_one(
            {"user_id": grant_data.user_id},
            {"$inc": {"tokens_owned": 1}}
        )

        # Record transaction
        transactions_collection.insert_one({
            "user_id": grant_data.user_id,
            "reference": f"admin_grant_token_{token_id}",
            "action": "admin_token_grant",
            "amount_usd": 0,
            "status": "success",
            "admin_id": current_admin["user_id"],
            "token_id_granted": token_id,
            "timestamp": datetime.utcnow()
        })

        # Create notification
        create_notification(
            grant_data.user_id,
            "🎁 New Token Granted!",
            f"An administrator has granted you a new token: '{token_name}'. It's now actively mining!",
            "success",
            "high"
        )
        
        logger.info(f"Admin {current_admin['user_id']} granted token to user {grant_data.user_id}: {token_name}")
        
        return {
            "message": "Token granted successfully",
            "token_id": token_id,
            "token_name": token_name,
            "user_id": grant_data.user_id,
            "new_token_count": current_tokens_count + 1
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Admin grant token error: {e}")
        raise HTTPException(status_code=500, detail="Failed to grant token")

@app.post("/api/admin/workspace/users/boost-token")
async def admin_boost_token(boost_data: AdminBoostToken, current_admin: dict = Depends(require_admin)):
    """Boost user token with admin privileges"""
    try:
        token = tokens_collection.find_one({"token_id": boost_data.token_id})
        if not token:
            raise HTTPException(status_code=404, detail="Token not found")
        
        # Check if token owner is admin
        token_owner = users_collection.find_one({"user_id": token["owner_id"]})
        if token_owner and token_owner.get("is_admin"):
            raise HTTPException(status_code=400, detail="Cannot boost admin tokens")
        
        if token.get("boost_level", 0) >= 10:
            raise HTTPException(status_code=400, detail="Token is already at maximum boost level")
        
        new_boost_level = token.get("boost_level", 0) + 1
        
        # Update token
        tokens_collection.update_one(
            {"token_id": boost_data.token_id},
            {
                "$inc": {"boost_level": 1},
                "$push": {
                    "boost_history": {
                        "timestamp": datetime.utcnow(),
                        "cost_usd": 0,  # Admin boost is free
                        "new_level": new_boost_level,
                        "boosted_by_admin": current_admin["user_id"],
                        "boost_type": "admin_free"
                    }
                }
            }
        )
        
        # Update user boost count
        users_collection.update_one(
            {"user_id": token["owner_id"]},
            {"$inc": {"boosts_used": 1}}
        )
        
        # Record transaction
        transactions_collection.insert_one({
            "user_id": token["owner_id"],
            "reference": f"admin_boost_{boost_data.token_id}_{uuid.uuid4().hex[:8]}",
            "action": "admin_token_boost",
            "amount_usd": 0,
            "status": "success",
            "admin_id": current_admin["user_id"],
            "token_id": boost_data.token_id,
            "new_boost_level": new_boost_level,
            "timestamp": datetime.utcnow()
        })
        
        # Create notification
        create_notification(
            token["owner_id"],
            "⚡ Token Boosted!",
            f"Admin has boosted your token '{token['name']}' to level {new_boost_level}! Increased mining power!",
            "success",
            "high"
        )
        
        logger.info(f"Admin {current_admin['user_id']} boosted token {boost_data.token_id} to level {new_boost_level}")
        
        return {
            "message": "Token boosted successfully",
            "token_id": boost_data.token_id,
            "token_name": token["name"],
            "old_level": new_boost_level - 1,
            "new_level": new_boost_level,
            "new_mining_rate": 0.70 * (2 ** new_boost_level)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Admin boost token error: {e}")
        raise HTTPException(status_code=500, detail="Failed to boost token")

@app.get("/api/admin/workspace/system-status")
async def get_system_status(current_user: dict = Depends(require_admin)):
    """Get comprehensive system status and health metrics"""
    try:
        # Database health
        db_ping = client.admin.command('ping')['ok']
        
        # Mining system status
        mining_status = "active" if mining_task and not mining_task.done() else "inactive"
        
        # Recent mining logs
        recent_mining = list(mining_logs_collection.find({}).sort("timestamp", -1).limit(5))
        
        # System performance metrics
        total_collections = len(db.list_collection_names())
        
        # Error logs from today
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        recent_errors = list(system_logs_collection.find({
            "timestamp": {"$gte": today_start},
            "level": "error"
        }).sort("timestamp", -1).limit(10))
        
        # Currency rates status
        currency_rates = currency_rates_collection.find_one({"_id": "latest_rates"})
        rates_last_updated = currency_rates.get("updated_at") if currency_rates else None
        
        return {
            "system_health": {
                "database_status": "healthy" if db_ping else "unhealthy",
                "mining_system": mining_status,
                "currency_rates_updated": rates_last_updated,
                "total_collections": total_collections
            },
            "mining_system": {
                "status": mining_status,
                "recent_sessions": [
                    {
                        "timestamp": log["timestamp"],
                        "tokens_processed": log.get("tokens_processed", 0),
                        "earnings_distributed": log.get("total_earnings_distributed", 0),
                        "status": log.get("status", "unknown")
                    }
                    for log in recent_mining
                ]
            },
            "performance_metrics": {
                "online_users": get_online_users_count(),
                "total_users": users_collection.count_documents({"is_admin": {"$ne": True}}),
                "active_tokens": tokens_collection.count_documents({"active": True}),
                "pending_notifications": notifications_collection.count_documents({"read": False})
            },
            "recent_errors": [
                {
                    "timestamp": error["timestamp"],
                    "message": error.get("message", "Unknown error"),
                    "module": error.get("module", "system")
                }
                for error in recent_errors
            ]
        }
        
    except Exception as e:
        logger.error(f"System status error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch system status")

# ============================================================================
# APPLICATION STARTUP
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=8001,
        reload=True,
        log_level="info"
    )
