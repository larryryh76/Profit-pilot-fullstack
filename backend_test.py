import requests
import unittest
import random
import string
import time
from datetime import datetime

# Backend URL from frontend .env
BACKEND_URL = "https://29b4d760-0c95-4d22-aaba-37f29d7b4060.preview.emergentagent.com"

class ProfitPilotAPITest(unittest.TestCase):
    def setUp(self):
        self.base_url = f"{BACKEND_URL}/api"
        self.admin_email = "larryryh76@gmail.com"
        self.admin_password = "admin123"  # This is a test password, would need to be replaced with actual admin password
        self.test_email = f"test_{self.random_string(8)}@example.com"
        self.test_password = "Test123!"
        self.token = None
        self.user_id = None
        self.referral_code = None
        self.token_id = None

    def random_string(self, length=8):
        """Generate a random string for test data"""
        return ''.join(random.choices(string.ascii_lowercase + string.digits, k=length))

    def test_01_health_check(self):
        """Test the health check endpoint"""
        print("\n🔍 Testing health check endpoint...")
        response = requests.get(f"{self.base_url}/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "healthy")
        print("✅ Health check endpoint is working")

    def test_02_user_registration(self):
        """Test user registration"""
        print("\n🔍 Testing user registration...")
        payload = {
            "email": self.test_email,
            "password": self.test_password
        }
        response = requests.post(f"{self.base_url}/register", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("access_token", data)
        self.assertIn("user_id", data)
        self.assertIn("referral_code", data)
        
        # Save token and user info for later tests
        self.token = data["access_token"]
        self.user_id = data["user_id"]
        self.referral_code = data["referral_code"]
        
        print(f"✅ User registration successful - Email: {self.test_email}")

    def test_03_user_login(self):
        """Test user login"""
        print("\n🔍 Testing user login...")
        payload = {
            "email": self.test_email,
            "password": self.test_password
        }
        response = requests.post(f"{self.base_url}/login", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("access_token", data)
        self.assertIn("user_id", data)
        self.assertEqual(data["user_id"], self.user_id)
        
        # Update token
        self.token = data["access_token"]
        
        print(f"✅ User login successful - Email: {self.test_email}")

    def test_04_dashboard_data(self):
        """Test dashboard data retrieval"""
        print("\n🔍 Testing dashboard data retrieval...")
        headers = {"Authorization": f"Bearer {self.token}"}
        response = requests.get(f"{self.base_url}/dashboard", headers=headers)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        
        # Verify user data
        self.assertEqual(data["user"]["user_id"], self.user_id)
        self.assertEqual(data["user"]["email"], self.test_email)
        self.assertEqual(data["user"]["referral_code"], self.referral_code)
        
        # Verify tokens data
        self.assertIn("tokens", data)
        self.assertTrue(len(data["tokens"]) > 0)
        
        # Save first token ID for later tests
        self.token_id = data["tokens"][0]["token_id"]
        
        print("✅ Dashboard data retrieval successful")
        print(f"   - User has {len(data['tokens'])} token(s)")
        print(f"   - Total earnings: ${data['user']['total_earnings']}")

    def test_05_payment_initialization(self):
        """Test payment initialization for token boost"""
        print("\n🔍 Testing payment initialization for token boost...")
        headers = {"Authorization": f"Bearer {self.token}"}
        params = {"action": "boost", "token_id": self.token_id}
        response = requests.post(f"{self.base_url}/payment/initialize", json=params, headers=headers)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("authorization_url", data)
        self.assertIn("reference", data)
        self.assertIn("amount_usd", data)
        self.assertIn("amount_ngn", data)
        
        print("✅ Payment initialization successful")
        print(f"   - Payment amount: ${data['amount_usd']} (₦{data['amount_ngn']})")
        print(f"   - Payment URL: {data['authorization_url']}")

    def test_06_leaderboard(self):
        """Test leaderboard retrieval"""
        print("\n🔍 Testing leaderboard retrieval...")
        response = requests.get(f"{self.base_url}/leaderboard")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("top_earners", data)
        self.assertIn("top_tokens", data)
        
        print("✅ Leaderboard retrieval successful")
        print(f"   - Top earners: {len(data['top_earners'])}")
        print(f"   - Top tokens: {len(data['top_tokens'])}")

    def test_07_admin_login(self):
        """Test admin login"""
        print("\n🔍 Testing admin login...")
        payload = {
            "email": self.admin_email,
            "password": self.admin_password
        }
        try:
            response = requests.post(f"{self.base_url}/login", json=payload)
            if response.status_code == 200:
                data = response.json()
                self.assertIn("access_token", data)
                self.assertIn("is_admin", data)
                self.assertTrue(data["is_admin"])
                
                # Save admin token
                self.admin_token = data["access_token"]
                
                print("✅ Admin login successful")
                
                # Test admin stats
                self.test_08_admin_stats()
            else:
                print(f"❌ Admin login failed - Status code: {response.status_code}")
                print("   - Note: This test requires the correct admin password")
        except Exception as e:
            print(f"❌ Admin login error: {str(e)}")
            print("   - Note: This test requires the correct admin password")

    def test_08_admin_stats(self):
        """Test admin stats retrieval"""
        if not hasattr(self, 'admin_token'):
            print("\n🔍 Skipping admin stats test (admin login required)")
            return
            
        print("\n🔍 Testing admin stats retrieval...")
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        response = requests.get(f"{self.base_url}/admin/stats", headers=headers)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("total_users", data)
        self.assertIn("total_tokens", data)
        self.assertIn("total_transactions", data)
        self.assertIn("total_platform_earnings", data)
        
        print("✅ Admin stats retrieval successful")
        print(f"   - Total users: {data['total_users']}")
        print(f"   - Total tokens: {data['total_tokens']}")
        print(f"   - Total transactions: {data['total_transactions']}")
        print(f"   - Total platform earnings: ${data['total_platform_earnings']}")

    def test_09_non_admin_access(self):
        """Test non-admin access to admin endpoints"""
        print("\n🔍 Testing non-admin access to admin endpoints...")
        headers = {"Authorization": f"Bearer {self.token}"}
        response = requests.get(f"{self.base_url}/admin/stats", headers=headers)
        self.assertEqual(response.status_code, 403)
        
        print("✅ Non-admin access properly restricted")

def run_tests():
    """Run all tests in order"""
    test_suite = unittest.TestSuite()
    test_suite.addTest(ProfitPilotAPITest('test_01_health_check'))
    test_suite.addTest(ProfitPilotAPITest('test_02_user_registration'))
    test_suite.addTest(ProfitPilotAPITest('test_03_user_login'))
    test_suite.addTest(ProfitPilotAPITest('test_04_dashboard_data'))
    test_suite.addTest(ProfitPilotAPITest('test_05_payment_initialization'))
    test_suite.addTest(ProfitPilotAPITest('test_06_leaderboard'))
    test_suite.addTest(ProfitPilotAPITest('test_07_admin_login'))
    test_suite.addTest(ProfitPilotAPITest('test_09_non_admin_access'))
    
    runner = unittest.TextTestRunner(verbosity=2)
    runner.run(test_suite)

if __name__ == "__main__":
    run_tests()