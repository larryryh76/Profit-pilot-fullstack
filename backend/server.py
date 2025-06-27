"""
ProfitPilot Professional Backend API v4.0.0
Advanced crypto earning platform with multi-currency support and professional admin workspace
"""

from fastapi import FastAPI, HTTPException, Depends, status, Request, BackgroundTasks
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from pymongo import MongoClient, ReturnDocument, ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError, ConnectionFailure
from pydantic import BaseModel, EmailStr, Field, validator, root_validator
from passlib.context import CryptContext
from datetime import datetime, timedelta, timezone
import jwt
import os
import uuid
import requests
import hashlib
import hmac
import asyncio
import logging
import redis
from typing import Optional, List, Dict, Any, Union
from contextlib import asynccontextmanager
from functools import wraps
import time
import json
from urllib.parse import urlparse
import re

# ============================================================================
# PROFESSIONAL CONFIGURATION & ENVIRONMENT
# ============================================================================

# Environment variables with validation
MONGO_URL = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "profitpilot_pro")
JWT_SECRET = os.getenv("JWT_SECRET", "SuperSecretKey123ProPilot2024!")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

# Payment configuration
PAYSTACK_SECRET_KEY = os.getenv("PAYSTACK_SECRET_KEY", "sk_live_b41107e30aa0682bdfbf68a60dbc3b49da6da6fa")
PAYSTACK_PUBLIC_KEY = os.getenv("PAYSTACK_PUBLIC_KEY", "pk_live_561c88fdbc97f356950fc7d9881101e4cb074707")

# Redis configuration for caching
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

# API rate limiting
RATE_LIMIT_REQUESTS = int(os.getenv("RATE_LIMIT_REQUESTS", "100"))
RATE_LIMIT_WINDOW = int(os.getenv("RATE_LIMIT_WINDOW", "3600"))

# Professional logging configuration
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(funcName)s:%(lineno)d - %(message)s',
    handlers=[
        logging.FileHandler('profitpilot.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Global variables
mining_task = None
redis_client = None

# ============================================================================
# PROFESSIONAL DATABASE CONNECTION WITH ERROR HANDLING
# ============================================================================

class DatabaseManager:
    def __init__(self):
        self.client = None
        self.db = None
        self.collections = {}
        self.connect()
    
    def connect(self):
        try:
            self.client = MongoClient(
                MONGO_URL,
                serverSelectionTimeoutMS=5000,
                connectTimeoutMS=10000,
                maxPoolSize=50,
                retryWrites=True
            )
            
            # Test connection
            self.client.admin.command('ping')
            self.db = self.client[DB_NAME]
            
            # Initialize collections with indexes
            self._initialize_collections()
            self._create_indexes()
            
            logger.info(f"✅ Connected to MongoDB: {MONGO_URL}")
            
        except ConnectionFailure as e:
            logger.error(f"❌ MongoDB connection failed: {e}")
            raise HTTPException(status_code=500, detail="Database connection failed")
    
    def _initialize_collections(self):
        """Initialize all database collections"""
        collection_names = [
            'users', 'tokens', 'transactions', 'referrals', 'mining_logs',
            'tasks', 'notifications', 'broadcasts', 'user_sessions',
            'currency_rates', 'admin_logs', 'security_logs', 'system_metrics'
        ]
        
        for name in collection_names:
            self.collections[name] = self.db[name]
    
    def _create_indexes(self):
        """Create database indexes for performance"""
        try:
            # User indexes
            self.collections['users'].create_index([("email", ASCENDING)], unique=True)
            self.collections['users'].create_index([("user_id", ASCENDING)], unique=True)
            self.collections['users'].create_index([("referral_code", ASCENDING)], unique=True)
            
            # Token indexes
            self.collections['tokens'].create_index([("token_id", ASCENDING)], unique=True)
            self.collections['tokens'].create_index([("owner_id", ASCENDING)])
            
            # Transaction indexes
            self.collections['transactions'].create_index([("user_id", ASCENDING)])
            self.collections['transactions'].create_index([("reference", ASCENDING)], unique=True)
            self.collections['transactions'].create_index([("timestamp", DESCENDING)])
            
            # Notification indexes
            self.collections['notifications'].create_index([("user_id", ASCENDING)])
            self.collections['notifications'].create_index([("created_at", DESCENDING)])
            
            # Session indexes
            self.collections['user_sessions'].create_index([("user_id", ASCENDING)], unique=True)
            self.collections['user_sessions'].create_index([("last_active", DESCENDING)])
            
            logger.info("✅ Database indexes created successfully")
            
        except Exception as e:
            logger.error(f"❌ Error creating indexes: {e}")

# Initialize database
db_manager = DatabaseManager()

# ============================================================================
# REDIS CACHE MANAGER
# ============================================================================

class CacheManager:
    def __init__(self):
        self.redis_client = None
        self.connect()
    
    def connect(self):
        try:
            self.redis_client = redis.from_url(REDIS_URL, decode_responses=True)
            self.redis_client.ping()
            logger.info("✅ Connected to Redis cache")
        except Exception as e:
            logger.warning(f"⚠️ Redis connection failed: {e}. Continuing without cache.")
            self.redis_client = None
    
    def get(self, key: str):
        if not self.redis_client:
            return None
        try:
            return self.redis_client.get(key)
        except Exception as e:
            logger.error(f"Cache get error: {e}")
            return None
    
    def set(self, key: str, value: str, expire: int = 3600):
        if not self.redis_client:
            return False
        try:
            return self.redis_client.setex(key, expire, value)
        except Exception as e:
            logger.error(f"Cache set error: {e}")
            return False
    
    def delete(self, key: str):
        if not self.redis_client:
            return False
        try:
            return self.redis_client.delete(key)
        except Exception as e:
            logger.error(f"Cache delete error: {e}")
            return False

cache_manager = CacheManager()

# ============================================================================
# PROFESSIONAL SECURITY & AUTHENTICATION
# ============================================================================

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

class SecurityManager:
    @staticmethod
    def hash_password(password: str) -> str:
        return pwd_context.hash(password)
    
    @staticmethod
    def verify_password(plain_password: str, hashed_password: str) -> bool:
        return pwd_context.verify(plain_password, hashed_password)
    
    @staticmethod
    def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
        to_encode = data.copy()
        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS)
        
        to_encode.update({
            "exp": expire,
            "iat": datetime.utcnow(),
            "type": "access"
        })
        
        return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)
    
    @staticmethod
    def verify_token(token: str) -> dict:
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            return payload
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token has expired")
        except jwt.JWTError:
            raise HTTPException(status_code=401, detail="Invalid token")
    
    @staticmethod
    def generate_secure_id(prefix: str = "PP") -> str:
        return f"{prefix}-{str(uuid.uuid4()).replace('-', '').upper()[:12]}"
    
    @staticmethod
    def generate_referral_code(email: str) -> str:
        hash_obj = hashlib.sha256(f"{email}{time.time()}".encode())
        return f"PP{hash_obj.hexdigest()[:8].upper()}"

security_manager = SecurityManager()

# ============================================================================
# PROFESSIONAL PYDANTIC MODELS WITH ADVANCED VALIDATION
# ============================================================================

class UserRegister(BaseModel):
    email: EmailStr
    password: str
    referral_code: Optional[str] = None
    
    @validator('password')
    def validate_password(cls, v):
        if len(v) < 8:
            raise ValueError('Password must be at least 8 characters long')
        if not re.search(r'[A-Za-z]', v):
            raise ValueError('Password must contain at least one letter')
        if not re.search(r'\d', v):
            raise ValueError('Password must contain at least one number')
        return v
    
    @validator('referral_code')
    def validate_referral_code(cls, v):
        if v and not re.match(r'^PP[A-Z0-9]{8}$', v):
            raise ValueError('Invalid referral code format')
        return v

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class ProfileUpdate(BaseModel):
    preferred_currency: Optional[str] = Field(None, regex=r'^[A-Z]{3}$')
    theme: Optional[str] = Field(None, regex=r'^(light|dark)$')
    notifications_enabled: Optional[bool] = None
    
    @validator('preferred_currency')
    def validate_currency(cls, v):
        if v:
            supported_currencies = ['USD', 'NGN', 'GBP', 'EUR', 'CAD', 'AUD', 'JPY', 'INR', 'ZAR']
            if v not in supported_currencies:
                raise ValueError(f'Currency must be one of: {", ".join(supported_currencies)}')
        return v

class PaymentInitialize(BaseModel):
    action: str = Field(..., regex=r'^(token|boost)$')
    token_id: Optional[str] = None
    
    @root_validator
    def validate_boost_requires_token(cls, values):
        if values.get('action') == 'boost' and not values.get('token_id'):
            raise ValueError('Token ID is required for boost action')
        return values

class PaymentVerification(BaseModel):
    reference: str = Field(..., min_length=10, max_length=100)

class AdminSendBalance(BaseModel):
    user_id: str = Field(..., regex=r'^PP-[A-Z0-9]{12}$')
    amount: float = Field(..., gt=0, le=10000)
    reason: str = Field(..., min_length=5, max_length=200)

class AdminCreateTask(BaseModel):
    title: str = Field(..., min_length=5, max_length=200)
    description: str = Field(..., min_length=10, max_length=1000)
    reward: float = Field(..., gt=0, le=1000)
    type: str = Field(..., regex=r'^(daily|one_time|repeatable)$')
    requirements: Optional[str] = Field(None, max_length=500)
    expires_at: Optional[datetime] = None
    verification_type: str = Field(default="manual", regex=r'^(manual|automatic|external)$')
    external_url: Optional[str] = None
    
    @validator('external_url')
    def validate_external_url(cls, v, values):
        if values.get('verification_type') == 'external' and not v:
            raise ValueError('External URL is required for external verification')
        if v and not v.startswith(('http://', 'https://')):
            raise ValueError('External URL must be a valid HTTP/HTTPS URL')
        return v

class AdminBroadcast(BaseModel):
    title: str = Field(..., min_length=5, max_length=200)
    message: str = Field(..., min_length=10, max_length=1000)
    type: str = Field(..., regex=r'^(info|warning|success|error)$')
    priority: str = Field(..., regex=r'^(low|medium|high)$')

class TaskComplete(BaseModel):
    task_id: str
    verification_data: Optional[Dict[str, Any]] = None

class AdminGrantToken(BaseModel):
    user_id: str = Field(..., regex=r'^PP-[A-Z0-9]{12}$')
    token_name: Optional[str] = Field("Admin Granted Token", min_length=1, max_length=100)

class AdminBoostToken(BaseModel):
    token_id: str

# ============================================================================
# PROFESSIONAL MULTI-CURRENCY SYSTEM
# ============================================================================

class CurrencyManager:
    def __init__(self):
        self.supported_currencies = {
            "USD": {"name": "US Dollar", "symbol": "$", "country_codes": ["US"]},
            "NGN": {"name": "Nigerian Naira", "symbol": "₦", "country_codes": ["NG"]},
            "GBP": {"name": "British Pound", "symbol": "£", "country_codes": ["GB", "UK"]},
            "EUR": {"name": "Euro", "symbol": "€", "country_codes": ["DE", "FR", "IT", "ES", "NL", "BE", "AT", "PT", "IE", "FI", "GR", "LU", "MT", "CY", "SK", "SI", "EE", "LV", "LT"]},
            "CAD": {"name": "Canadian Dollar", "symbol": "C$", "country_codes": ["CA"]},
            "AUD": {"name": "Australian Dollar", "symbol": "A$", "country_codes": ["AU"]},
            "JPY": {"name": "Japanese Yen", "symbol": "¥", "country_codes": ["JP"]},
            "INR": {"name": "Indian Rupee", "symbol": "₹", "country_codes": ["IN"]},
            "ZAR": {"name": "South African Rand", "symbol": "R", "country_codes": ["ZA"]}
        }
        self.cache_duration = 3600  # 1 hour
    
    async def get_exchange_rates(self) -> Dict[str, float]:
        """Get real-time exchange rates with caching"""
        cache_key = "exchange_rates"
        cached_rates = cache_manager.get(cache_key)
        
        if cached_rates:
            try:
                return json.loads(cached_rates)
            except json.JSONDecodeError:
                pass
        
        try:
            # Primary API
            response = requests.get(
                "https://api.exchangerate-api.com/v4/latest/USD",
                timeout=10
            )
            response.raise_for_status()
            data = response.json()
            rates = data['rates']
            
            # Cache the rates
            cache_manager.set(cache_key, json.dumps(rates), self.cache_duration)
            
            # Store in database as backup
            db_manager.collections['currency_rates'].update_one(
                {"_id": "latest_rates"},
                {
                    "$set": {
                        "rates": rates,
                        "updated_at": datetime.utcnow(),
                        "source": "exchangerate-api"
                    }
                },
                upsert=True
            )
            
            logger.info("✅ Exchange rates updated successfully")
            return rates
            
        except Exception as e:
            logger.error(f"❌ Error fetching exchange rates: {e}")
            
            # Fallback to database
            cached_db_rates = db_manager.collections['currency_rates'].find_one({"_id": "latest_rates"})
            if cached_db_rates and 'rates' in cached_db_rates:
                logger.info("Using cached database rates")
                return cached_db_rates['rates']
            
            # Final fallback to static rates
            fallback_rates = {
                "USD": 1.0, "NGN": 1500.0, "GBP": 0.75, "EUR": 0.85,
                "CAD": 1.25, "AUD": 1.35, "JPY": 110.0, "INR": 75.0, "ZAR": 15.0
            }
            logger.warning("Using fallback exchange rates")
            return fallback_rates
    
    async def detect_user_country(self, request: Request) -> str:
        """Detect user's country from IP with multiple fallbacks"""
        try:
            # Get client IP
            client_ip = request.client.host
            
            # Check for forwarded headers
            forwarded_for = request.headers.get("X-Forwarded-For")
            if forwarded_for:
                client_ip = forwarded_for.split(",")[0].strip()
            
            real_ip = request.headers.get("X-Real-IP")
            if real_ip:
                client_ip = real_ip
            
            # Skip localhost
            if client_ip in ["127.0.0.1", "localhost", "::1"]:
                return "NG"  # Default to Nigeria
            
            # Try multiple IP geolocation services
            services = [
                f"http://ipinfo.io/{client_ip}/json",
                f"https://ipapi.co/{client_ip}/json/",
                f"http://ip-api.com/json/{client_ip}"
            ]
            
            for service_url in services:
                try:
                    response = requests.get(service_url, timeout=5)
                    response.raise_for_status()
                    data = response.json()
                    
                    # Extract country code based on service
                    country = None
                    if 'country' in data:
                        country = data['country']
                    elif 'country_code' in data:
                        country = data['country_code']
                    elif 'countryCode' in data:
                        country = data['countryCode']
                    
                    if country and len(country) == 2:
                        logger.info(f"Detected country: {country} for IP: {client_ip}")
                        return country.upper()
                        
                except Exception as service_error:
                    logger.warning(f"IP service {service_url} failed: {service_error}")
                    continue
            
            logger.warning(f"Could not detect country for IP: {client_ip}")
            return "NG"  # Default fallback
            
        except Exception as e:
            logger.error(f"Country detection error: {e}")
            return "NG"
    
    def get_currency_for_country(self, country_code: str) -> str:
        """Map country code to currency"""
        for currency, info in self.supported_currencies.items():
            if country_code in info['country_codes']:
                return currency
        return "USD"  # Default fallback
    
    async def convert_currency(self, amount: float, from_currency: str, to_currency: str) -> float:
        """Convert amount between currencies"""
        if from_currency == to_currency:
            return round(amount, 2)
        
        try:
            rates = await self.get_exchange_rates()
            
            # Convert to USD first if needed
            if from_currency != "USD":
                usd_amount = amount / rates.get(from_currency, 1)
            else:
                usd_amount = amount
            
            # Convert from USD to target currency
            if to_currency != "USD":
                converted_amount = usd_amount * rates.get(to_currency, 1)
            else:
                converted_amount = usd_amount
            
            return round(converted_amount, 2)
            
        except Exception as e:
            logger.error(f"Currency conversion error: {e}")
            return round(amount, 2)  # Return original amount on error

currency_manager = CurrencyManager()

# ============================================================================
# PROFESSIONAL SESSION & USER MANAGEMENT
# ============================================================================

class SessionManager:
    @staticmethod
    def update_user_session(user_id: str, additional_data: Dict = None):
        """Update user session with comprehensive tracking"""
        session_data = {
            "last_active": datetime.utcnow(),
            "ip_address": additional_data.get("ip_address") if additional_data else None,
            "user_agent": additional_data.get("user_agent") if additional_data else None
        }
        
        db_manager.collections['user_sessions'].update_one(
            {"user_id": user_id},
            {
                "$set": session_data,
                "$setOnInsert": {"first_login": datetime.utcnow()},
                "$inc": {"login_count": 1}
            },
            upsert=True
        )
    
    @staticmethod
    def get_online_users_count() -> int:
        """Get count of users active in last 5 minutes"""
        five_minutes_ago = datetime.utcnow() - timedelta(minutes=5)
        return db_manager.collections['user_sessions'].count_documents({
            "last_active": {"$gte": five_minutes_ago}
        })
    
    @staticmethod
    def get_user_activity_stats(user_id: str) -> Dict:
        """Get comprehensive user activity statistics"""
        session = db_manager.collections['user_sessions'].find_one({"user_id": user_id})
        if not session:
            return {}
        
        return {
            "first_login": session.get("first_login"),
            "last_active": session.get("last_active"),
            "login_count": session.get("login_count", 0),
            "is_online": (datetime.utcnow() - session.get("last_active", datetime.min)).total_seconds() < 300
        }

session_manager = SessionManager()

# ============================================================================
# PROFESSIONAL NOTIFICATION SYSTEM
# ============================================================================

class NotificationManager:
    @staticmethod
    def create_notification(
        user_id: str,
        title: str,
        message: str,
        notification_type: str = "info",
        metadata: Dict = None
    ) -> Dict:
        """Create a professional notification with metadata"""
        notification_doc = {
            "notification_id": security_manager.generate_secure_id("NOTIF"),
            "user_id": user_id,
            "title": title,
            "message": message,
            "type": notification_type,
            "read": False,
            "created_at": datetime.utcnow(),
            "metadata": metadata or {},
            "priority": "normal"
        }
        
        try:
            db_manager.collections['notifications'].insert_one(notification_doc)
            logger.info(f"Notification created for user {user_id}: {title}")
            return notification_doc
        except Exception as e:
            logger.error(f"Failed to create notification: {e}")
            return {}
    
    @staticmethod
    def mark_notification_read(notification_id: str, user_id: str) -> bool:
        """Mark notification as read"""
        try:
            result = db_manager.collections['notifications'].update_one(
                {"notification_id": notification_id, "user_id": user_id},
                {"$set": {"read": True, "read_at": datetime.utcnow()}}
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Failed to mark notification as read: {e}")
            return False
    
    @staticmethod
    def get_user_notifications(user_id: str, limit: int = 50) -> List[Dict]:
        """Get user notifications with pagination"""
        try:
            notifications = list(
                db_manager.collections['notifications']
                .find({"user_id": user_id})
                .sort("created_at", -1)
                .limit(limit)
            )
            
            for notif in notifications:
                notif['_id'] = str(notif['_id'])
            
            return notifications
        except Exception as e:
            logger.error(f"Failed to get notifications: {e}")
            return []
    
    @staticmethod
    def get_unread_count(user_id: str) -> int:
        """Get count of unread notifications"""
        try:
            return db_manager.collections['notifications'].count_documents({
                "user_id": user_id,
                "read": False
            })
        except Exception as e:
            logger.error(f"Failed to get unread count: {e}")
            return 0

notification_manager = NotificationManager()

# ============================================================================
# PROFESSIONAL AUTOMATED MINING SYSTEM
# ============================================================================

class MiningManager:
    def __init__(self):
        self.base_earning = 0.70
        self.mining_interval = 7200  # 2 hours in seconds
        self.is_running = False
    
    async def process_mining_cycle(self) -> Dict:
        """Professional automated mining process"""
        start_time = datetime.utcnow()
        mining_stats = {
            "tokens_processed": 0,
            "total_earnings_distributed": 0.0,
            "errors": [],
            "start_time": start_time,
            "status": "running"
        }
        
        try:
            logger.info("🚀 Starting automated mining cycle...")
            
            # Get all active tokens (excluding admin-owned tokens)
            admin_user_ids = [
                user["user_id"] for user in 
                db_manager.collections['users'].find({"is_admin": True}, {"user_id": 1})
            ]
            
            tokens = list(db_manager.collections['tokens'].find({
                "active": True,
                "owner_id": {"$nin": admin_user_ids}
            }))
            
            for token in tokens:
                try:
                    # Calculate earnings based on boost level
                    boost_level = token.get('boost_level', 0)
                    earning = self.base_earning * (2 ** boost_level)
                    
                    # Update token earnings
                    db_manager.collections['tokens'].update_one(
                        {"token_id": token["token_id"]},
                        {
                            "$inc": {"total_earnings": earning},
                            "$set": {"last_mining": datetime.utcnow()},
                            "$push": {
                                "mining_history": {
                                    "amount": earning,
                                    "timestamp": datetime.utcnow(),
                                    "boost_level": boost_level,
                                    "cycle_id": str(uuid.uuid4())
                                }
                            }
                        }
                    )
                    
                    # Update user total earnings
                    user_update_result = db_manager.collections['users'].update_one(
                        {"user_id": token["owner_id"]},
                        {"$inc": {"total_earnings": earning}}
                    )
                    
                    if user_update_result.modified_count > 0:
                        # Create notification for successful mining
                        notification_manager.create_notification(
                            token["owner_id"],
                            "Mining Completed! 💰",
                            f"Your token '{token['name']}' earned ${earning:.2f}",
                            "success",
                            {
                                "token_id": token["token_id"],
                                "amount": earning,
                                "boost_level": boost_level
                            }
                        )
                    
                    mining_stats["tokens_processed"] += 1
                    mining_stats["total_earnings_distributed"] += earning
                    
                except Exception as token_error:
                    error_msg = f"Error processing token {token.get('token_id', 'unknown')}: {token_error}"
                    logger.error(error_msg)
                    mining_stats["errors"].append(error_msg)
            
            # Update mining statistics
            end_time = datetime.utcnow()
            mining_stats.update({
                "end_time": end_time,
                "duration_seconds": (end_time - start_time).total_seconds(),
                "status": "completed"
            })
            
            # Log mining cycle to database
            db_manager.collections['mining_logs'].insert_one({
                "cycle_id": str(uuid.uuid4()),
                "timestamp": start_time,
                "end_timestamp": end_time,
                "tokens_processed": mining_stats["tokens_processed"],
                "total_earnings_distributed": mining_stats["total_earnings_distributed"],
                "duration_seconds": mining_stats["duration_seconds"],
                "errors_count": len(mining_stats["errors"]),
                "errors": mining_stats["errors"],
                "status": "success" if not mining_stats["errors"] else "partial_success"
            })
            
            logger.info(
                f"✅ Mining cycle completed! "
                f"Processed {mining_stats['tokens_processed']} tokens, "
                f"distributed ${mining_stats['total_earnings_distributed']:.2f}"
            )
            
            return mining_stats
            
        except Exception as e:
            error_msg = f"Critical mining error: {e}"
            logger.error(error_msg)
            
            mining_stats.update({
                "status": "failed",
                "end_time": datetime.utcnow(),
                "critical_error": error_msg
            })
            
            # Log failed mining cycle
            db_manager.collections['mining_logs'].insert_one({
                "cycle_id": str(uuid.uuid4()),
                "timestamp": start_time,
                "end_timestamp": datetime.utcnow(),
                "tokens_processed": 0,
                "total_earnings_distributed": 0.0,
                "status": "failed",
                "error": error_msg
            })
            
            return mining_stats
    
    async def mining_scheduler(self):
        """Professional mining scheduler with error recovery"""
        logger.info("⏰ Professional mining scheduler started - 2-hour automated cycles")
        self.is_running = True
        
        while self.is_running:
            try:
                # Process mining cycle
                await self.process_mining_cycle()
                
                # Wait for next cycle (2 hours)
                await asyncio.sleep(self.mining_interval)
                
            except asyncio.CancelledError:
                logger.info("Mining scheduler cancelled")
                break
            except Exception as e:
                logger.error(f"❌ Mining scheduler error: {e}")
                # Wait 10 minutes before retry on error
                await asyncio.sleep(600)
        
        self.is_running = False
        logger.info("Mining scheduler stopped")
    
    def stop_mining(self):
        """Stop the mining scheduler"""
        self.is_running = False

mining_manager = MiningManager()

# ============================================================================
# PROFESSIONAL AUTHENTICATION DEPENDENCIES
# ============================================================================

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    request: Request = None
) -> dict:
    """Get current authenticated user with session tracking"""
    try:
        payload = security_manager.verify_token(credentials.credentials)
        user_id = payload.get("sub")
        
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token payload")
        
        user = db_manager.collections['users'].find_one({"user_id": user_id})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        
        # Update session with request info
        session_data = {}
        if request:
            session_data = {
                "ip_address": request.client.host,
                "user_agent": request.headers.get("User-Agent", "")
            }
        
        session_manager.update_user_session(user_id, session_data)
        
        return user
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Authentication error: {e}")
        raise HTTPException(status_code=401, detail="Authentication failed")

async def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """Require admin privileges with logging"""
    if not current_user.get("is_admin"):
        # Log unauthorized admin access attempt
        db_manager.collections['security_logs'].insert_one({
            "event": "unauthorized_admin_access",
            "user_id": current_user["user_id"],
            "timestamp": datetime.utcnow(),
            "ip_address": "unknown"
        })
        raise HTTPException(status_code=403, detail="Admin access required")
    
    return current_user

# ============================================================================
# PROFESSIONAL TASK MANAGEMENT SYSTEM
# ============================================================================

class TaskManager:
    @staticmethod
    def create_task(task_data: AdminCreateTask, admin_id: str) -> Dict:
        """Create a dynamic task with advanced verification"""
        task_id = security_manager.generate_secure_id("TASK")
        
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
            "created_by": admin_id,
            "created_at": datetime.utcnow(),
            "active": True,
            "completed_by": [],
            "completion_data": [],
            "total_completions": 0,
            "total_rewards_paid": 0.0
        }
        
        try:
            db_manager.collections['tasks'].insert_one(task_doc)
            
            # Notify all non-admin users about new task
            non_admin_users = list(
                db_manager.collections['users'].find(
                    {"is_admin": {"$ne": True}},
                    {"user_id": 1}
                )
            )
            
            for user in non_admin_users:
                notification_manager.create_notification(
                    user["user_id"],
                    "New Task Available! 🎯",
                    f"{task_data.title} - Earn ${task_data.reward:.2f}",
                    "info",
                    {"task_id": task_id, "reward": task_data.reward}
                )
            
            logger.info(f"Task created: {task_id} by admin {admin_id}")
            return task_doc
            
        except Exception as e:
            logger.error(f"Failed to create task: {e}")
            raise HTTPException(status_code=500, detail="Failed to create task")
    
    @staticmethod
    def complete_task(task_id: str, user_id: str, verification_data: Dict = None) -> Dict:
        """Complete a task with verification"""
        try:
            task = db_manager.collections['tasks'].find_one({
                "task_id": task_id,
                "active": True
            })
            
            if not task:
                raise HTTPException(status_code=404, detail="Task not found or inactive")
            
            # Check if user already completed this task
            if user_id in task.get("completed_by", []):
                if task["type"] == "one_time":
                    raise HTTPException(status_code=400, detail="Task already completed")
            
            # Check expiration
            if task.get("expires_at") and task["expires_at"] < datetime.utcnow():
                raise HTTPException(status_code=400, detail="Task has expired")
            
            # Process task completion
            completion_record = {
                "user_id": user_id,
                "completed_at": datetime.utcnow(),
                "verification_data": verification_data or {},
                "reward_amount": task["reward"]
            }
            
            # Update user earnings
            db_manager.collections['users'].update_one(
                {"user_id": user_id},
                {"$inc": {"total_earnings": task["reward"]}}
            )
            
            # Update task completion records
            update_data = {
                "$push": {
                    "completion_data": completion_record
                },
                "$inc": {
                    "total_completions": 1,
                    "total_rewards_paid": task["reward"]
                }
            }
            
            # For one-time tasks, add user to completed_by list
            if task["type"] == "one_time":
                update_data["$addToSet"] = {"completed_by": user_id}
            
            db_manager.collections['tasks'].update_one(
                {"task_id": task_id},
                update_data
            )
            
            # Record transaction
            db_manager.collections['transactions'].insert_one({
                "transaction_id": security_manager.generate_secure_id("TXN"),
                "user_id": user_id,
                "reference": f"task_{task_id}_{uuid.uuid4().hex[:8]}",
                "action": "task_completion",
                "amount_usd": task["reward"],
                "amount_ngn": 0,
                "status": "success",
                "task_id": task_id,
                "task_title": task["title"],
                "timestamp": datetime.utcnow()
            })
            
            # Create success notification
            notification_manager.create_notification(
                user_id,
                "Task Completed! 🎉",
                f"You've earned ${task['reward']:.2f} for completing '{task['title']}'",
                "success",
                {
                    "task_id": task_id,
                    "reward": task["reward"],
                    "task_title": task["title"]
                }
            )
            
            logger.info(f"Task {task_id} completed by user {user_id}")
            return {"message": "Task completed successfully", "reward": task["reward"]}
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Task completion error: {e}")
            raise HTTPException(status_code=500, detail="Failed to complete task")

task_manager = TaskManager()

# ============================================================================
# LIFESPAN MANAGEMENT
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Professional application lifespan management"""
    logger.info("🚀 ProfitPilot Professional API v4.0.0 starting...")
    
    # Start automated mining system
    global mining_task
    mining_task = asyncio.create_task(mining_manager.mining_scheduler())
    logger.info("⛏️ Automated mining system initialized")
    
    # Initialize currency rates
    try:
        await currency_manager.get_exchange_rates()
        logger.info("💱 Currency system initialized")
    except Exception as e:
        logger.warning(f"Currency initialization warning: {e}")
    
    yield
    
    # Cleanup
    logger.info("🛑 ProfitPilot API shutting down...")
    
    if mining_task:
        mining_manager.stop_mining()
        mining_task.cancel()
        try:
            await mining_task
        except asyncio.CancelledError:
            logger.info("⛏️ Mining task cancelled successfully")

# ============================================================================
# FASTAPI APPLICATION SETUP
# ============================================================================

app = FastAPI(
    title="ProfitPilot Professional API",
    version="4.0.0",
    description="Advanced crypto earning platform with professional multi-currency support and automated mining",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# Professional middleware setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["*"]  # Configure appropriately for production
)

# ============================================================================
# PROFESSIONAL API ENDPOINTS
# ============================================================================

@app.get("/api/health")
async def health_check():
    """Comprehensive health check endpoint"""
    try:
        # Test database connection
        db_manager.client.admin.command('ping')
        db_status = "healthy"
    except Exception:
        db_status = "unhealthy"
    
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow(),
        "version": "4.0.0",
        "database_status": db_status,
        "mining_status": "active" if mining_manager.is_running else "inactive",
        "cache_status": "active" if cache_manager.redis_client else "inactive",
        "services": {
            "authentication": "operational",
            "currency_conversion": "operational",
            "notifications": "operational",
            "task_system": "operational"
        }
    }

@app.post("/api/register")
async def register_user(user_data: UserRegister, request: Request):
    """Professional user registration with enhanced security"""
    try:
        # Check if email already exists
        existing_user = db_manager.collections['users'].find_one({"email": user_data.email})
        if existing_user:
            raise HTTPException(status_code=400, detail="Email already registered")
        
        # Generate secure identifiers
        user_id = security_manager.generate_secure_id("PP")
        referral_code = security_manager.generate_referral_code(user_data.email)
        hashed_password = security_manager.hash_password(user_data.password)
        
        # Detect user's country and set currency
        country = await currency_manager.detect_user_country(request)
        preferred_currency = currency_manager.get_currency_for_country(country)
        
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
            "account_status": "active",
            "security_settings": {
                "two_factor_enabled": False,
                "login_notifications": True
            }
        }
        
        # Insert user
        db_manager.collections['users'].insert_one(user_doc)
        
        # Process referral if provided
        if user_data.referral_code:
            await self._process_referral(user_data.referral_code, user_id, user_doc.get("is_admin", False))
        
        # Create first free token for non-admin users
        if not user_doc.get("is_admin"):
            await self._create_first_token(user_id)
        
        # Generate access token
        access_token = security_manager.create_access_token(data={"sub": user_id})
        
        # Update session
        session_manager.update_user_session(user_id, {
            "ip_address": request.client.host,
            "user_agent": request.headers.get("User-Agent", "")
        })
        
        # Create welcome notification
        notification_manager.create_notification(
            user_id,
            "Welcome to ProfitPilot! 🚀",
            "Your account has been created successfully. Start earning with automated mining!",
            "success"
        )
        
        logger.info(f"✅ New user registered: {user_id} ({user_data.email}) from {country}")
        
        return {
            "message": "User registered successfully",
            "access_token": access_token,
            "user_id": user_id,
            "referral_code": referral_code,
            "is_admin": user_doc.get("is_admin", False),
            "preferred_currency": preferred_currency,
            "country": country
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Registration error: {e}")
        raise HTTPException(status_code=500, detail="Registration failed")

async def _process_referral(referral_code: str, new_user_id: str, is_admin: bool):
    """Process referral bonus"""
    try:
        referrer = db_manager.collections['users'].find_one({"referral_code": referral_code})
        if referrer and not referrer.get("is_admin"):
            # Give bonus to referrer
            db_manager.collections['users'].update_one(
                {"user_id": referrer["user_id"]},
                {"$inc": {"referral_earnings": 2.0, "total_earnings": 2.0, "referrals_count": 1}}
            )
            
            # Give bonus to new user if not admin
            if not is_admin:
                db_manager.collections['users'].update_one(
                    {"user_id": new_user_id},
                    {"$inc": {"referral_earnings": 2.0, "total_earnings": 2.0}}
                )
            
            # Record referral
            db_manager.collections['referrals'].insert_one({
                "referral_id": security_manager.generate_secure_id("REF"),
                "referrer_id": referrer["user_id"],
                "referred_id": new_user_id,
                "amount": 2.0,
                "timestamp": datetime.utcnow(),
                "status": "completed"
            })
            
            # Notify referrer
            notification_manager.create_notification(
                referrer["user_id"],
                "Referral Bonus! 🎉",
                f"You've earned $2.00 for referring a new user!",
                "success",
                {"amount": 2.0, "referred_user": new_user_id}
            )
            
    except Exception as e:
        logger.error(f"Referral processing error: {e}")

async def _create_first_token(user_id: str):
    """Create first free token for new user"""
    try:
        token_id = security_manager.generate_secure_id("TOKEN")
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
            "token_type": "starter"
        }
        
        db_manager.collections['tokens'].insert_one(token_doc)
        db_manager.collections['users'].update_one(
            {"user_id": user_id},
            {"$inc": {"tokens_owned": 1}}
        )
        
    except Exception as e:
        logger.error(f"First token creation error: {e}")

@app.post("/api/login")
async def login_user(user_data: UserLogin, request: Request):
    """Professional user login with security logging"""
    try:
        user = db_manager.collections['users'].find_one({"email": user_data.email})
        
        if not user:
            # Log failed login attempt
            db_manager.collections['security_logs'].insert_one({
                "event": "failed_login_attempt",
                "email": user_data.email,
                "reason": "user_not_found",
                "ip_address": request.client.host,
                "timestamp": datetime.utcnow()
            })
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        if not security_manager.verify_password(user_data.password, user["password"]):
            # Log failed password attempt
            db_manager.collections['security_logs'].insert_one({
                "event": "failed_login_attempt",
                "email": user_data.email,
                "user_id": user["user_id"],
                "reason": "invalid_password",
                "ip_address": request.client.host,
                "timestamp": datetime.utcnow()
            })
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        # Check account status
        if user.get("account_status") != "active":
            raise HTTPException(status_code=403, detail="Account is suspended")
        
        # Generate access token
        access_token = security_manager.create_access_token(data={"sub": user["user_id"]})
        
        # Update session
        session_manager.update_user_session(user["user_id"], {
            "ip_address": request.client.host,
            "user_agent": request.headers.get("User-Agent", "")
        })
        
        # Log successful login
        db_manager.collections['security_logs'].insert_one({
            "event": "successful_login",
            "user_id": user["user_id"],
            "ip_address": request.client.host,
            "timestamp": datetime.utcnow()
        })
        
        logger.info(f"✅ User logged in: {user['user_id']}")
        
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
    """Professional dashboard with comprehensive data and currency conversion"""
    try:
        # Get fresh user data
        fresh_user = db_manager.collections['users'].find_one({"user_id": current_user["user_id"]})
        if not fresh_user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Get user's tokens
        tokens = list(db_manager.collections['tokens'].find({"owner_id": current_user["user_id"]}))
        
        # Calculate next mining time
        next_mining = None
        if tokens:
            last_mining_times = [t.get("last_mining", t["created_at"]) for t in tokens]
            last_mining = max(last_mining_times)
            next_mining = last_mining + timedelta(hours=2)
        
        # Get user's preferred currency
        user_currency = fresh_user.get("preferred_currency", "USD")
        
        # Convert earnings to user's preferred currency
        total_earnings_converted = await currency_manager.convert_currency(
            fresh_user["total_earnings"], "USD", user_currency
        )
        referral_earnings_converted = await currency_manager.convert_currency(
            fresh_user["referral_earnings"], "USD", user_currency
        )
        
        # Convert token earnings
        converted_tokens = []
        for token in tokens:
            token_earnings_converted = await currency_manager.convert_currency(
                token["total_earnings"], "USD", user_currency
            )
            
            converted_tokens.append({
                "token_id": token["token_id"],
                "name": token["name"],
                "boost_level": token["boost_level"],
                "total_earnings": token["total_earnings"],
                "total_earnings_converted": token_earnings_converted,
                "created_at": token["created_at"],
                "last_mining": token.get("last_mining"),
                "hourly_rate": (0.70 * (2 ** token["boost_level"])) / 2,
                "active": token.get("active", True)
            })
        
        # Calculate mining rate in user's currency
        total_mining_rate_usd = sum([0.70 * (2 ** t["boost_level"]) for t in tokens])
        total_mining_rate_converted = await currency_manager.convert_currency(
            total_mining_rate_usd, "USD", user_currency
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
                "notifications_enabled": fresh_user.get("notifications_enabled", True),
                "country": fresh_user.get("country", "Unknown")
            },
            "tokens": converted_tokens,
            "next_mining": next_mining,
            "stats": {
                "active_assets": len([t for t in tokens if t.get("active", True)]),
                "total_balance": fresh_user["total_earnings"],
                "total_balance_converted": total_earnings_converted,
                "mining_rate_usd": total_mining_rate_usd,
                "mining_rate_converted": total_mining_rate_converted,
                "currency": user_currency,
                "currency_symbol": currency_manager.supported_currencies.get(user_currency, {}).get("symbol", "$")
            },
            "activity": session_manager.get_user_activity_stats(current_user["user_id"])
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Dashboard error: {e}")
        raise HTTPException(status_code=500, detail="Failed to load dashboard")

@app.post("/api/profile/update")
async def update_profile(profile_data: ProfileUpdate, current_user: dict = Depends(get_current_user)):
    """Professional profile update with validation"""
    try:
        update_fields = {}
        
        if profile_data.preferred_currency:
            # Validate currency is supported
            rates = await currency_manager.get_exchange_rates()
            if profile_data.preferred_currency not in rates:
                raise HTTPException(status_code=400, detail="Unsupported currency")
            update_fields["preferred_currency"] = profile_data.preferred_currency
        
        if profile_data.theme:
            update_fields["theme"] = profile_data.theme
        
        if profile_data.notifications_enabled is not None:
            update_fields["notifications_enabled"] = profile_data.notifications_enabled
        
        if update_fields:
            update_fields["updated_at"] = datetime.utcnow()
            
            result = db_manager.collections['users'].update_one(
                {"user_id": current_user["user_id"]},
                {"$set": update_fields}
            )
            
            if result.modified_count == 0:
                raise HTTPException(status_code=400, detail="No changes made")
            
            # Log profile update
            db_manager.collections['admin_logs'].insert_one({
                "event": "profile_updated",
                "user_id": current_user["user_id"],
                "changes": update_fields,
                "timestamp": datetime.utcnow()
            })
        
        return {
            "message": "Profile updated successfully",
            "updated_fields": list(update_fields.keys())
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Profile update error: {e}")
        raise HTTPException(status_code=500, detail="Profile update failed")

@app.get("/api/currencies")
async def get_supported_currencies():
    """Get supported currencies with current exchange rates"""
    try:
        rates = await currency_manager.get_exchange_rates()
        
        return {
            "currencies": currency_manager.supported_currencies,
            "rates": rates,
            "base_currency": "USD",
            "last_updated": datetime.utcnow()
        }
        
    except Exception as e:
        logger.error(f"Currency fetch error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch currencies")

@app.post("/api/payment/initialize")
async def initialize_payment(payment_data: PaymentInitialize, current_user: dict = Depends(get_current_user)):
    """Professional payment initialization with enhanced validation"""
    try:
        if current_user.get("is_admin"):
            raise HTTPException(status_code=400, detail="Admin accounts cannot make payments")
        
        action = payment_data.action
        token_id = payment_data.token_id
        
        # Calculate amount based on action
        if action == "token":
            if current_user["tokens_owned"] >= 5:
                raise HTTPException(status_code=400, detail="Maximum 5 tokens allowed per user")
            amount_usd = 5.0
            
        elif action == "boost":
            if not token_id:
                raise HTTPException(status_code=400, detail="Token ID required for boost")
            
            token = db_manager.collections['tokens'].find_one({
                "token_id": token_id,
                "owner_id": current_user["user_id"]
            })
            if not token:
                raise HTTPException(status_code=404, detail="Token not found or not owned by user")
            
            amount_usd = 3.0 * (2 ** token["boost_level"])
        
        # Convert to NGN for Paystack
        rates = await currency_manager.get_exchange_rates()
        exchange_rate = rates.get("NGN", 1500)
        amount_ngn = amount_usd * exchange_rate
        amount_kobo = int(amount_ngn * 100)
        
        # Generate unique reference
        reference = f"pp_{action}_{uuid.uuid4().hex[:12]}"
        
        # Prepare Paystack payload
        paystack_data = {
            "email": current_user["email"],
            "amount": amount_kobo,
            "currency": "NGN",
            "reference": reference,
            "callback_url": f"{os.getenv('FRONTEND_URL', 'http://localhost:3000')}/payment/callback",
            "metadata": {
                "user_id": current_user["user_id"],
                "action": action,
                "token_id": token_id,
                "amount_usd": amount_usd,
                "exchange_rate": exchange_rate
            }
        }
        
        # Initialize payment with Paystack
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
            
            # Store payment initialization record
            db_manager.collections['transactions'].insert_one({
                "transaction_id": security_manager.generate_secure_id("TXN"),
                "user_id": current_user["user_id"],
                "reference": reference,
                "action": action,
                "amount_usd": amount_usd,
                "amount_ngn": amount_ngn,
                "status": "initialized",
                "paystack_reference": data["data"]["reference"],
                "token_id": token_id,
                "timestamp": datetime.utcnow()
            })
            
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
    """Professional payment verification with comprehensive logging"""
    try:
        if current_user.get("is_admin"):
            raise HTTPException(status_code=400, detail="Admin accounts cannot verify payments")
        
        reference = payment_data.reference
        
        # Verify with Paystack
        headers = {"Authorization": f"Bearer {PAYSTACK_SECRET_KEY}"}
        
        response = requests.get(
            f"https://api.paystack.co/transaction/verify/{reference}",
            headers=headers,
            timeout=30
        )
        
        if response.status_code != 200:
            logger.error(f"Paystack verification failed: {response.text}")
            raise HTTPException(status_code=400, detail="Payment verification failed")
        
        data = response.json()
        if data["data"]["status"] != "success":
            raise HTTPException(status_code=400, detail="Payment was not successful")
        
        # Get transaction metadata
        metadata = data["data"]["metadata"]
        action = metadata["action"]
        amount_usd = metadata["amount_usd"]
        
        # Verify transaction belongs to current user
        if metadata["user_id"] != current_user["user_id"]:
            raise HTTPException(status_code=403, detail="Payment verification failed - user mismatch")
        
        # Check if payment already processed
        existing_transaction = db_manager.collections['transactions'].find_one({
            "reference": reference,
            "status": "success"
        })
        if existing_transaction:
            raise HTTPException(status_code=400, detail="Payment already processed")
        
        # Process payment based on action
        if action == "token":
            await self._process_token_purchase(current_user["user_id"], amount_usd)
            
        elif action == "boost":
            token_id = metadata["token_id"]
            await self._process_token_boost(current_user["user_id"], token_id, amount_usd)
        
        # Update transaction record
        db_manager.collections['transactions'].update_one(
            {"reference": reference},
            {
                "$set": {
                    "status": "success",
                    "verified_at": datetime.utcnow(),
                    "paystack_data": data["data"]
                }
            }
        )
        
        # Create success notification
        notification_manager.create_notification(
            current_user["user_id"],
            "Payment Successful! 🎉",
            f"Your {action} payment of ${amount_usd:.2f} has been processed successfully",
            "success",
            {"action": action, "amount": amount_usd}
        )
        
        logger.info(f"Payment verified successfully: {reference} for user {current_user['user_id']}")
        
        return {
            "message": "Payment processed successfully",
            "action": action,
            "amount_usd": amount_usd,
            "reference": reference
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Payment verification error: {e}")
        raise HTTPException(status_code=500, detail="Payment verification failed")

async def _process_token_purchase(user_id: str, amount_usd: float):
    """Process token purchase"""
    try:
        # Get current token count
        user = db_manager.collections['users'].find_one({"user_id": user_id})
        token_count = user["tokens_owned"] + 1
        
        # Create new token
        token_id = security_manager.generate_secure_id("TOKEN")
        token_doc = {
            "token_id": token_id,
            "owner_id": user_id,
            "name": f"ProfitToken #{token_count}",
            "boost_level": 0,
            "total_earnings": 0.0,
            "created_at": datetime.utcnow(),
            "last_mining": datetime.utcnow(),
            "active": True,
            "mining_history": [],
            "boost_history": [],
            "token_type": "purchased",
            "purchase_amount": amount_usd
        }
        
        db_manager.collections['tokens'].insert_one(token_doc)
        db_manager.collections['users'].update_one(
            {"user_id": user_id},
            {"$inc": {"tokens_owned": 1}}
        )
        
        logger.info(f"Token purchased: {token_id} by user {user_id}")
        
    except Exception as e:
        logger.error(f"Token purchase processing error: {e}")
        raise

async def _process_token_boost(user_id: str, token_id: str, amount_usd: float):
    """Process token boost"""
    try:
        token = db_manager.collections['tokens'].find_one({
            "token_id": token_id,
            "owner_id": user_id
        })
        
        if not token:
            raise HTTPException(status_code=404, detail="Token not found")
        
        # Update token boost level
        new_boost_level = token["boost_level"] + 1
        
        db_manager.collections['tokens'].update_one(
            {"token_id": token_id},
            {
                "$inc": {"boost_level": 1},
                "$push": {
                    "boost_history": {
                        "timestamp": datetime.utcnow(),
                        "cost_usd": amount_usd,
                        "new_level": new_boost_level,
                        "boost_type": "paid"
                    }
                }
            }
        )
        
        db_manager.collections['users'].update_one(
            {"user_id": user_id},
            {"$inc": {"boosts_used": 1}}
        )
        
        logger.info(f"Token boosted: {token_id} to level {new_boost_level} by user {user_id}")
        
    except Exception as e:
        logger.error(f"Token boost processing error: {e}")
        raise

@app.get("/api/notifications")
async def get_user_notifications(current_user: dict = Depends(get_current_user)):
    """Get user notifications with pagination"""
    try:
        notifications = notification_manager.get_user_notifications(current_user["user_id"])
        unread_count = notification_manager.get_unread_count(current_user["user_id"])
        
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
        success = notification_manager.mark_notification_read(notification_id, current_user["user_id"])
        
        if not success:
            raise HTTPException(status_code=404, detail="Notification not found")
        
        return {"message": "Notification marked as read"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Mark notification read error: {e}")
        raise HTTPException(status_code=500, detail="Failed to mark notification as read")

@app.get("/api/tasks")
async def get_available_tasks(current_user: dict = Depends(get_current_user)):
    """Get available tasks for user"""
    try:
        if current_user.get("is_admin"):
            return {"tasks": [], "message": "Admin users cannot complete tasks"}
        
        # Get tasks that are active and not expired
        current_time = datetime.utcnow()
        
        tasks = list(db_manager.collections['tasks'].find({
            "active": True,
            "$or": [
                {"expires_at": None},
                {"expires_at": {"$gt": current_time}}
            ]
        }).sort("created_at", -1))
        
        # Filter out completed one-time tasks
        available_tasks = []
        for task in tasks:
            if task["type"] == "one_time" and current_user["user_id"] in task.get("completed_by", []):
                continue
            
            # Clean up ObjectId for JSON serialization
            task['_id'] = str(task['_id'])
            available_tasks.append(task)
        
        return {
            "tasks": available_tasks,
            "total_available": len(available_tasks)
        }
        
    except Exception as e:
        logger.error(f"Tasks fetch error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch tasks")

@app.post("/api/tasks/complete")
async def complete_task(task_complete: TaskComplete, current_user: dict = Depends(get_current_user)):
    """Complete a task and earn reward"""
    try:
        if current_user.get("is_admin"):
            raise HTTPException(status_code=400, detail="Admin users cannot complete tasks")
        
        result = task_manager.complete_task(
            task_complete.task_id,
            current_user["user_id"],
            task_complete.verification_data
        )
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Task completion error: {e}")
        raise HTTPException(status_code=500, detail="Failed to complete task")

@app.get("/api/leaderboard")
async def get_leaderboard():
    """Get leaderboard with privacy protection"""
    try:
        # Get top earners (excluding admins)
        top_earners = list(
            db_manager.collections['users'].find(
                {"is_admin": {"$ne": True}},
                {
                    "user_id": 1,
                    "email": 1,
                    "total_earnings": 1,
                    "tokens_owned": 1,
                    "boosts_used": 1,
                    "referrals_count": 1
                }
            ).sort("total_earnings", -1).limit(10)
        )
        
        # Get top tokens (excluding admin-owned)
        admin_user_ids = [
            user["user_id"] for user in 
            db_manager.collections['users'].find({"is_admin": True}, {"user_id": 1})
        ]
        
        top_tokens = list(
            db_manager.collections['tokens'].find(
                {"owner_id": {"$nin": admin_user_ids}},
                {
                    "name": 1,
                    "boost_level": 1,
                    "total_earnings": 1,
                    "owner_id": 1
                }
            ).sort("boost_level", -1).limit(10)
        )
        
        # Anonymize data for privacy
        anonymized_earners = []
        for user in top_earners:
            email = user["email"]
            anonymized_email = email[:3] + "***" + email[-10:] if len(email) > 13 else "***"
            
            anonymized_earners.append({
                "user_id": user["user_id"][:8] + "***",
                "email": anonymized_email,
                "total_earnings": user["total_earnings"],
                "tokens_owned": user["tokens_owned"],
                "boosts_used": user["boosts_used"],
                "referrals_count": user["referrals_count"]
            })
        
        anonymized_tokens = []
        for token in top_tokens:
            anonymized_tokens.append({
                "name": token["name"],
                "boost_level": token["boost_level"],
                "total_earnings": token["total_earnings"],
                "owner_id": token["owner_id"][:8] + "***"
            })
        
        return {
            "top_earners": anonymized_earners,
            "top_tokens": anonymized_tokens,
            "last_updated": datetime.utcnow()
        }
        
    except Exception as e:
        logger.error(f"Leaderboard error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch leaderboard")

# ============================================================================
# PROFESSIONAL ADMIN WORKSPACE ENDPOINTS
# ============================================================================

@app.get("/api/admin/workspace/dashboard")
async def get_admin_dashboard(current_user: dict = Depends(require_admin)):
    """Professional admin dashboard with comprehensive metrics"""
    try:
        # Revenue metrics
        revenue_pipeline = [
            {"$match": {"action": {"$in": ["token", "boost"]}, "status": "success"}},
            {"$group": {"_id": None, "total": {"$sum": "$amount_usd"}}}
        ]
        revenue_result = list(db_manager.collections['transactions'].aggregate(revenue_pipeline))
        total_revenue = revenue_result[0]["total"] if revenue_result else 0
        
        # User metrics
        total_users = db_manager.collections['users'].count_documents({"is_admin": {"$ne": True}})
        users_online = session_manager.get_online_users_count()
        
        # Today's metrics
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        new_users_today = db_manager.collections['users'].count_documents({
            "created_at": {"$gte": today_start},
            "is_admin": {"$ne": True}
        })
        
        # Token metrics
        total_tokens = db_manager.collections['tokens'].count_documents({})
        active_tokens = db_manager.collections['tokens'].count_documents({"active": True})
        tokens_bought = db_manager.collections['transactions'].count_documents({
            "action": "token",
            "status": "success"
        })
        boost_purchases = db_manager.collections['transactions'].count_documents({
            "action": "boost",
            "status": "success"
        })
        
        # Task metrics
        total_tasks = db_manager.collections['tasks'].count_documents({})
        task_completions_pipeline = [
            {"$project": {"completion_count": {"$size": {"$ifNull": ["$completed_by", []]}}}},
            {"$group": {"_id": None, "total": {"$sum": "$completion_count"}}}
        ]
        task_completions_result = list(db_manager.collections['tasks'].aggregate(task_completions_pipeline))
        total_task_completions = task_completions_result[0]["total"] if task_completions_result else 0
        
        # Mining status
        latest_mining = db_manager.collections['mining_logs'].find_one(
            {"status": {"$in": ["success", "partial_success"]}},
            sort=[("timestamp", -1)]
        )
        
        # Recent activity
        recent_transactions = list(
            db_manager.collections['transactions'].find({})
            .sort("timestamp", -1)
            .limit(10)
        )
        
        recent_users = list(
            db_manager.collections['users'].find(
                {"is_admin": {"$ne": True}},
                {"password": 0}
            ).sort("created_at", -1).limit(5)
        )
        
        # Clean up ObjectIds
        for tx in recent_transactions:
            tx['_id'] = str(tx['_id'])
        for user in recent_users:
            user['_id'] = str(user['_id'])
        
        return {
            "revenue_metrics": {
                "total_revenue": total_revenue,
                "monthly_revenue": 0,  # TODO: Implement monthly calculation
                "daily_revenue": 0     # TODO: Implement daily calculation
            },
            "user_metrics": {
                "total_users": total_users,
                "users_online": users_online,
                "new_users_today": new_users_today
            },
            "token_metrics": {
                "total_tokens": total_tokens,
                "active_tokens": active_tokens,
                "tokens_bought": tokens_bought,
                "boost_purchases": boost_purchases
            },
            "platform_activity": {
                "total_transactions": db_manager.collections['transactions'].count_documents({}),
                "total_tasks": total_tasks,
                "total_task_completions": total_task_completions,
                "total_broadcasts": db_manager.collections['broadcasts'].count_documents({})
            },
            "mining_status": {
                "last_mining": latest_mining["timestamp"] if latest_mining else None,
                "tokens_processed_today": latest_mining["tokens_processed"] if latest_mining else 0,
                "earnings_distributed_today": latest_mining["total_earnings_distributed"] if latest_mining else 0,
                "system_status": "automated",
                "next_cycle": "Every 2 hours automatically"
            },
            "recent_activity": {
                "recent_transactions": recent_transactions,
                "recent_users": recent_users
            },
            "system_health": {
                "database_status": "healthy",
                "mining_system": "operational",
                "api_status": "healthy"
            }
        }
        
    except Exception as e:
        logger.error(f"Admin dashboard error: {e}")
        raise HTTPException(status_code=500, detail="Failed to load admin dashboard")

@app.get("/api/admin/workspace/users")
async def get_all_users(current_user: dict = Depends(require_admin)):
    """Get all users with comprehensive data"""
    try:
        users = list(
            db_manager.collections['users'].find(
                {"is_admin": {"$ne": True}},
                {"password": 0}
            ).sort("created_at", -1)
        )
        
        # Enhance user data
        for user in users:
            user['_id'] = str(user['_id'])
            
            # Get token information
            user_tokens = list(db_manager.collections['tokens'].find({"owner_id": user["user_id"]}))
            user['tokens_count'] = len(user_tokens)
            user['active_tokens_count'] = len([t for t in user_tokens if t.get("active", True)])
            user['total_token_earnings'] = sum([t.get("total_earnings", 0) for t in user_tokens])
            
            # Get transaction count
            user['transaction_count'] = db_manager.collections['transactions'].count_documents({
                "user_id": user["user_id"]
            })
            
            # Get session info
            session = db_manager.collections['user_sessions'].find_one({"user_id": user["user_id"]})
            if session:
                last_active = session.get("last_active")
                if last_active and (datetime.utcnow() - last_active).total_seconds() < 300:
                    user['online_status'] = "online"
                else:
                    user['online_status'] = "offline"
                user['last_active'] = last_active
            else:
                user['online_status'] = "offline"
                user['last_active'] = None
        
        return {
            "users": users,
            "total": len(users),
            "online_count": len([u for u in users if u.get('online_status') == 'online'])
        }
        
    except Exception as e:
        logger.error(f"Admin users fetch error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch users")

@app.get("/api/admin/workspace/users/{user_id}")
async def get_user_details(user_id: str, current_user: dict = Depends(require_admin)):
    """Get comprehensive user details"""
    try:
        user = db_manager.collections['users'].find_one({"user_id": user_id}, {"password": 0})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        user['_id'] = str(user['_id'])
        
        # Get user's tokens
        tokens = list(db_manager.collections['tokens'].find({"owner_id": user_id}))
        for token in tokens:
            token['_id'] = str(token['_id'])
        
        # Get user's transactions
        transactions = list(
            db_manager.collections['transactions'].find({"user_id": user_id})
            .sort("timestamp", -1)
            .limit(20)
        )
        for tx in transactions:
            tx['_id'] = str(tx['_id'])
        
        # Get referral information
        referrals = list(db_manager.collections['referrals'].find({"referrer_id": user_id}))
        for ref in referrals:
            ref['_id'] = str(ref['_id'])
        
        # Get notifications
        notifications = list(
            db_manager.collections['notifications'].find({"user_id": user_id})
            .sort("created_at", -1)
            .limit(10)
        )
        for notif in notifications:
            notif['_id'] = str(notif['_id'])
        
        # Get session information
        session = db_manager.collections['user_sessions'].find_one({"user_id": user_id})
        
        return {
            "user": user,
            "tokens": tokens,
            "transactions": transactions,
            "referrals": referrals,
            "notifications": notifications,
            "session_info": session,
            "statistics": {
                "total_tokens": len(tokens),
                "total_transactions": len(transactions),
                "total_referrals": len(referrals),
                "unread_notifications": len([n for n in notifications if not n.get("read", False)])
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"User details fetch error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch user details")

@app.post("/api/admin/workspace/send-balance")
async def admin_send_balance(balance_data: AdminSendBalance, current_user: dict = Depends(require_admin)):
    """Send balance to a user"""
    try:
        # Verify target user exists
        target_user = db_manager.collections['users'].find_one({"user_id": balance_data.user_id})
        if not target_user:
            raise HTTPException(status_code=404, detail="Target user not found")
        
        if target_user.get("is_admin"):
            raise HTTPException(status_code=400, detail="Cannot send balance to admin users")
        
        # Update user balance
        db_manager.collections['users'].update_one(
            {"user_id": balance_data.user_id},
            {"$inc": {"total_earnings": balance_data.amount}}
        )
        
        # Record transaction
        transaction_id = security_manager.generate_secure_id("TXN")
        db_manager.collections['transactions'].insert_one({
            "transaction_id": transaction_id,
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
        
        # Create notification
        notification_manager.create_notification(
            balance_data.user_id,
            "Balance Added! 💰",
            f"Admin has added ${balance_data.amount:.2f} to your account. Reason: {balance_data.reason}",
            "success",
            {
                "amount": balance_data.amount,
                "reason": balance_data.reason,
                "admin_id": current_user["user_id"]
            }
        )
        
        # Log admin action
        db_manager.collections['admin_logs'].insert_one({
            "action": "balance_sent",
            "admin_id": current_user["user_id"],
            "target_user_id": balance_data.user_id,
            "amount": balance_data.amount,
            "reason": balance_data.reason,
            "timestamp": datetime.utcnow()
        })
        
        logger.info(f"Admin {current_user['user_id']} sent ${balance_data.amount:.2f} to {balance_data.user_id}")
        
        return {
            "message": "Balance sent successfully",
            "amount": balance_data.amount,
            "recipient": balance_data.user_id,
            "transaction_id": transaction_id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Admin send balance error: {e}")
        raise HTTPException(status_code=500, detail="Failed to send balance")

@app.post("/api/admin/workspace/create-task")
async def admin_create_task(task_data: AdminCreateTask, current_user: dict = Depends(require_admin)):
    """Create dynamic task with advanced verification options"""
    try:
        task_doc = task_manager.create_task(task_data, current_user["user_id"])
        
        # Log admin action
        db_manager.collections['admin_logs'].insert_one({
            "action": "task_created",
            "admin_id": current_user["user_id"],
            "task_id": task_doc["task_id"],
            "task_title": task_data.title,
            "reward": task_data.reward,
            "timestamp": datetime.utcnow()
        })
        
        return {
            "message": "Task created successfully",
            "task_id": task_doc["task_id"],
            "task_details": task_doc
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Admin create task error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create task")

@app.get("/api/admin/workspace/tasks")
async def get_admin_tasks(current_user: dict = Depends(require_admin)):
    """Get all tasks with completion statistics"""
    try:
        tasks = list(db_manager.collections['tasks'].find({}).sort("created_at", -1))
        
        for task in tasks:
            task['_id'] = str(task['_id'])
            task['completion_count'] = len(task.get('completed_by', []))
            task['total_rewards_paid'] = task['completion_count'] * task['reward']
            
            # Get recent completions
            recent_completions = task.get('completion_data', [])[-5:]  # Last 5 completions
            task['recent_completions'] = recent_completions
        
        return {
            "tasks": tasks,
            "total_tasks": len(tasks),
            "active_tasks": len([t for t in tasks if t.get('active', True)])
        }
        
    except Exception as e:
        logger.error(f"Admin tasks fetch error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch tasks")

@app.post("/api/admin/workspace/broadcast")
async def admin_broadcast(broadcast_data: AdminBroadcast, current_user: dict = Depends(require_admin)):
    """Send broadcast message to all users"""
    try:
        broadcast_id = security_manager.generate_secure_id("BROADCAST")
        
        # Get all non-admin users
        non_admin_users = list(
            db_manager.collections['users'].find(
                {"is_admin": {"$ne": True}},
                {"user_id": 1}
            )
        )
        
        # Create notifications for all users
        for user in non_admin_users:
            notification_manager.create_notification(
                user["user_id"],
                broadcast_data.title,
                broadcast_data.message,
                broadcast_data.type,
                {
                    "broadcast_id": broadcast_id,
                    "priority": broadcast_data.priority,
                    "admin_id": current_user["user_id"]
                }
            )
        
        # Store broadcast record
        broadcast_doc = {
            "broadcast_id": broadcast_id,
            "title": broadcast_data.title,
            "message": broadcast_data.message,
            "type": broadcast_data.type,
            "priority": broadcast_data.priority,
            "admin_id": current_user["user_id"],
            "created_at": datetime.utcnow(),
            "recipient_count": len(non_admin_users)
        }
        
        db_manager.collections['broadcasts'].insert_one(broadcast_doc)
        
        # Log admin action
        db_manager.collections['admin_logs'].insert_one({
            "action": "broadcast_sent",
            "admin_id": current_user["user_id"],
            "broadcast_id": broadcast_id,
            "title": broadcast_data.title,
            "recipient_count": len(non_admin_users),
            "timestamp": datetime.utcnow()
        })
        
        logger.info(f"Admin {current_user['user_id']} sent broadcast to {len(non_admin_users)} users")
        
        return {
            "message": "Broadcast sent successfully",
            "broadcast_id": broadcast_id,
            "recipients": len(non_admin_users)
        }
        
    except Exception as e:
        logger.error(f"Admin broadcast error: {e}")
        raise HTTPException(status_code=500, detail="Failed to send broadcast")

@app.get("/api/admin/workspace/broadcasts")
async def get_admin_broadcasts(current_user: dict = Depends(require_admin)):
    """Get all admin broadcasts"""
    try:
        broadcasts = list(
            db_manager.collections['broadcasts'].find({})
            .sort("created_at", -1)
            .limit(50)
        )
        
        for broadcast in broadcasts:
            broadcast['_id'] = str(broadcast['_id'])
        
        return {
            "broadcasts": broadcasts,
            "total_broadcasts": len(broadcasts)
        }
        
    except Exception as e:
        logger.error(f"Admin broadcasts fetch error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch broadcasts")

@app.post("/api/admin/workspace/users/grant-token")
async def admin_grant_token_to_user(grant_data: AdminGrantToken, current_user: dict = Depends(require_admin)):
    """Grant token to user"""
    try:
        # Verify target user
        target_user = db_manager.collections['users'].find_one({"user_id": grant_data.user_id})
        if not target_user:
            raise HTTPException(status_code=404, detail="Target user not found")
        
        if target_user.get("is_admin"):
            raise HTTPException(status_code=400, detail="Cannot grant tokens to admin users")
        
        # Check token limit
        current_tokens = db_manager.collections['tokens'].count_documents({"owner_id": grant_data.user_id})
        if current_tokens >= 5:
            raise HTTPException(status_code=400, detail="User already has maximum tokens (5)")
        
        # Create token
        token_id = security_manager.generate_secure_id("TOKEN")
        token_name = grant_data.token_name or f"ProfitToken #{current_tokens + 1}"
        
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
            "granted_by_admin": current_user["user_id"],
            "grant_reason": "Admin grant",
            "token_type": "admin_granted"
        }
        
        db_manager.collections['tokens'].insert_one(token_doc)
        db_manager.collections['users'].update_one(
            {"user_id": grant_data.user_id},
            {"$inc": {"tokens_owned": 1}}
        )
        
        # Record transaction
        db_manager.collections['transactions'].insert_one({
            "transaction_id": security_manager.generate_secure_id("TXN"),
            "user_id": grant_data.user_id,
            "reference": f"admin_grant_token_{token_id}",
            "action": "admin_token_grant",
            "amount_usd": 0,
            "status": "success",
            "admin_id": current_user["user_id"],
            "token_id_granted": token_id,
            "timestamp": datetime.utcnow()
        })
        
        # Create notification
        notification_manager.create_notification(
            grant_data.user_id,
            "🎁 New Token Granted!",
            f"An administrator has granted you a new token: '{token_name}'",
            "success",
            {
                "token_id": token_id,
                "token_name": token_name,
                "admin_id": current_user["user_id"]
            }
        )
        
        # Log admin action
        db_manager.collections['admin_logs'].insert_one({
            "action": "token_granted",
            "admin_id": current_user["user_id"],
            "target_user_id": grant_data.user_id,
            "token_id": token_id,
            "token_name": token_name,
            "timestamp": datetime.utcnow()
        })
        
        logger.info(f"Admin {current_user['user_id']} granted token to {grant_data.user_id}")
        
        return {
            "message": "Token granted successfully",
            "token_details": token_doc
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Admin grant token error: {e}")
        raise HTTPException(status_code=500, detail="Failed to grant token")

@app.post("/api/admin/workspace/tokens/boost-token")
async def admin_boost_user_token(boost_data: AdminBoostToken, current_user: dict = Depends(require_admin)):
    """Boost user token"""
    try:
        # Find token
        token = db_manager.collections['tokens'].find_one({"token_id": boost_data.token_id})
        if not token:
            raise HTTPException(status_code=404, detail="Token not found")
        
        # Verify token owner is not admin
        token_owner = db_manager.collections['users'].find_one({"user_id": token["owner_id"]})
        if not token_owner:
            raise HTTPException(status_code=404, detail="Token owner not found")
        
        if token_owner.get("is_admin"):
            raise HTTPException(status_code=400, detail="Cannot boost admin-owned tokens")
        
        # Boost token
        new_boost_level = token.get("boost_level", 0) + 1
        
        updated_token = db_manager.collections['tokens'].find_one_and_update(
            {"token_id": boost_data.token_id},
            {
                "$inc": {"boost_level": 1},
                "$push": {
                    "boost_history": {
                        "timestamp": datetime.utcnow(),
                        "cost_usd": 0,
                        "new_level": new_boost_level,
                        "boosted_by_admin": current_user["user_id"],
                        "boost_reason": "Admin boost",
                        "boost_type": "admin_granted"
                    }
                }
            },
            return_document=ReturnDocument.AFTER
        )
        
        # Record transaction
        db_manager.collections['transactions'].insert_one({
            "transaction_id": security_manager.generate_secure_id("TXN"),
            "user_id": token["owner_id"],
            "reference": f"admin_boost_token_{boost_data.token_id}",
            "action": "admin_token_boost",
            "amount_usd": 0,
            "status": "success",
            "admin_id": current_user["user_id"],
            "boosted_token_id": boost_data.token_id,
            "new_boost_level": new_boost_level,
            "timestamp": datetime.utcnow()
        })
        
        # Create notification
        notification_manager.create_notification(
            token["owner_id"],
            "🚀 Token Boosted!",
            f"An administrator has boosted your token '{token['name']}' to Level {new_boost_level}!",
            "success",
            {
                "token_id": boost_data.token_id,
                "token_name": token["name"],
                "new_boost_level": new_boost_level,
                "admin_id": current_user["user_id"]
            }
        )
        
        # Log admin action
        db_manager.collections['admin_logs'].insert_one({
            "action": "token_boosted",
            "admin_id": current_user["user_id"],
            "target_user_id": token["owner_id"],
            "token_id": boost_data.token_id,
            "new_boost_level": new_boost_level,
            "timestamp": datetime.utcnow()
        })
        
        logger.info(f"Admin {current_user['user_id']} boosted token {boost_data.token_id} to level {new_boost_level}")
        
        return {
            "message": "Token boosted successfully",
            "token_details": updated_token
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Admin boost token error: {e}")
        raise HTTPException(status_code=500, detail="Failed to boost token")

@app.get("/api/admin/workspace/system-status")
async def get_system_status(current_user: dict = Depends(require_admin)):
    """Get comprehensive system status"""
    try:
        # Get recent mining logs
        recent_mining = list(
            db_manager.collections['mining_logs'].find({})
            .sort("timestamp", -1)
            .limit(10)
        )
        
        for log in recent_mining:
            log['_id'] = str(log['_id'])
        
        # Get system metrics
        total_users = db_manager.collections['users'].count_documents({})
        active_users = session_manager.get_online_users_count()
        
        # Database health check
        try:
            db_manager.client.admin.command('ping')
            db_status = "healthy"
        except Exception:
            db_status = "unhealthy"
        
        return {
            "system_health": {
                "database_status": db_status,
                "total_users": total_users,
                "active_users": active_users,
                "system_load": "normal",
                "api_status": "operational"
            },
            "mining_system": {
                "status": "automated",
                "is_running": mining_manager.is_running,
                "next_cycle": "Every 2 hours automatically",
                "intervention_required": False,
                "recent_logs": recent_mining
            },
            "performance_metrics": {
                "cache_status": "active" if cache_manager.redis_client else "inactive",
                "database_connections": "optimal",
                "response_time": "normal"
            },
            "security_status": {
                "authentication": "operational",
                "rate_limiting": "active",
                "encryption": "enabled"
            }
        }
        
    except Exception as e:
        logger.error(f"System status error: {e}")
        raise HTTPException(status_code=500, detail="Failed to get system status")

# ============================================================================
# ERROR HANDLERS
# ============================================================================

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Professional error handling"""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": True,
            "message": exc.detail,
            "status_code": exc.status_code,
            "timestamp": datetime.utcnow().isoformat()
        }
    )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handle unexpected errors"""
    logger.error(f"Unexpected error: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "error": True,
            "message": "Internal server error",
            "status_code": 500,
            "timestamp": datetime.utcnow().isoformat()
        }
    )

# ============================================================================
# APPLICATION STARTUP
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    
    logger.info("🚀 Starting ProfitPilot Professional API v4.0.0")
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8001,
        log_level="info",
        access_log=True,
        reload=True
    )
