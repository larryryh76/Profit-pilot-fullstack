import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

// Get backend URL from environment
const BACKEND_URL = process.env.REACT_APP_API_URL || 'http://localhost:8001';

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState('home');
  const [profileSubTab, setProfileSubTab] = useState('account');
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [leaderboardData, setLeaderboardData] = useState(null);
  const [adminStats, setAdminStats] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [miningCountdown, setMiningCountdown] = useState('');
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [notifications, setNotifications] = useState([]);

  // Auth form state
  const [authForm, setAuthForm] = useState({
    email: '',
    password: '',
    referralCode: ''
  });

  // Profile form state
  const [profileForm, setProfileForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  // Check for existing token and handle referral on app load
  useEffect(() => {
    // Check for referral code in URL
    const urlParams = new URLSearchParams(window.location.search);
    const referralCode = urlParams.get('ref');
    if (referralCode) {
      setAuthForm(prev => ({ ...prev, referralCode }));
      setAuthMode('register');
    }

    // Check for payment verification
    const reference = urlParams.get('reference');
    if (reference) {
      handlePaymentVerification(reference);
    }

    const token = localStorage.getItem('profitpilot_token');
    if (token) {
      fetchDashboard(token);
    } else {
      setShowAuth(true);
    }
  }, []);

  // Mining countdown timer
  useEffect(() => {
    if (dashboardData?.next_mining) {
      const timer = setInterval(() => {
        const now = new Date();
        const nextMining = new Date(dashboardData.next_mining);
        const diff = nextMining - now;
        
        if (diff <= 0) {
          setMiningCountdown('Mining now! 🎉');
          fetchDashboard(); // Refresh data
        } else {
          const hours = Math.floor(diff / (1000 * 60 * 60));
          const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
          const seconds = Math.floor((diff % (1000 * 60)) / 1000);
          setMiningCountdown(`${hours}h ${minutes}m ${seconds}s`);
        }
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [dashboardData?.next_mining]);

  const fetchDashboard = async (token = null) => {
    try {
      setLoading(true);
      const authToken = token || localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/dashboard`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      setDashboardData(response.data);
      setCurrentUser(response.data.user);
      setShowAuth(false);
      
      // Show onboarding for new users
      if (response.data.user.tokens_owned === 1 && !localStorage.getItem('onboarding_completed')) {
        setShowOnboarding(true);
      }
    } catch (error) {
      console.error('Dashboard fetch error:', error);
      if (error.response?.status === 401) {
        localStorage.removeItem('profitpilot_token');
        setShowAuth(true);
      } else {
        showNotification('Failed to load dashboard data', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const endpoint = authMode === 'login' ? '/api/login' : '/api/register';
      const payload = authMode === 'login' 
        ? { email: authForm.email, password: authForm.password }
        : { email: authForm.email, password: authForm.password, referral_code: authForm.referralCode };
      
      const response = await axios.post(`${BACKEND_URL}${endpoint}`, payload);
      
      localStorage.setItem('profitpilot_token', response.data.access_token);
      await fetchDashboard(response.data.access_token);
      
      setAuthForm({ email: '', password: '', referralCode: '' });
      showNotification(`${authMode === 'login' ? 'Logged in' : 'Account created'} successfully!`, 'success');
    } catch (error) {
      showNotification(error.response?.data?.detail || 'Authentication failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('profitpilot_token');
    localStorage.removeItem('onboarding_completed');
    setCurrentUser(null);
    setDashboardData(null);
    setShowAuth(true);
    setActiveTab('home');
    showNotification('Logged out successfully', 'success');
  };

  const handlePayment = async (action, tokenId = null) => {
    try {
      setLoading(true);
      const token = localStorage.getItem('profitpilot_token');
      
      const response = await axios.post(
        `${BACKEND_URL}/api/payment/initialize`,
        { action, token_id: tokenId },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (response.data.authorization_url) {
        window.location.href = response.data.authorization_url;
      } else {
        showNotification('Payment initialization failed', 'error');
      }
    } catch (error) {
      console.error('Payment error:', error);
      showNotification(error.response?.data?.detail || 'Payment initialization failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handlePaymentVerification = async (reference) => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.post(
        `${BACKEND_URL}/api/payment/verify`,
        { reference },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      showNotification('Payment successful! 🎉', 'success');
      fetchDashboard();
      
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (error) {
      showNotification('Payment verification failed', 'error');
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (profileForm.newPassword !== profileForm.confirmPassword) {
      showNotification('Passwords do not match', 'error');
      return;
    }

    try {
      setLoading(true);
      // This endpoint would need to be added to your backend
      showNotification('Password change feature coming soon!', 'info');
    } catch (error) {
      showNotification('Password change failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchLeaderboard = async () => {
    try {
      const response = await axios.get(`${BACKEND_URL}/api/leaderboard`);
      setLeaderboardData(response.data);
    } catch (error) {
      console.error('Leaderboard fetch error:', error);
    }
  };

  const fetchAdminStats = async () => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/admin/stats`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAdminStats(response.data);
    } catch (error) {
      console.error('Admin stats fetch error:', error);
    }
  };

  useEffect(() => {
    if (activeTab === 'board' && !leaderboardData) {
      fetchLeaderboard();
    }
    if (activeTab === 'admin' && currentUser?.is_admin && !adminStats) {
      fetchAdminStats();
    }
  }, [activeTab]);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount || 0);
  };

  const formatTimeUntilWithdrawal = (eligibleDate) => {
    if (!eligibleDate) return 'Loading...';
    
    const now = new Date();
    const eligible = new Date(eligibleDate);
    const diff = eligible - now;
    
    if (diff <= 0) return 'Eligible now!';
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    return `${days} days, ${hours} hours`;
  };

  const copyReferralLink = () => {
    const referralLink = `${window.location.origin}?ref=${currentUser.referral_code}`;
    navigator.clipboard.writeText(referralLink);
    showNotification('Referral link copied to clipboard! 📋', 'success');
  };

  const showNotification = (message, type = 'info') => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  const completeOnboarding = () => {
    localStorage.setItem('onboarding_completed', 'true');
    setShowOnboarding(false);
    showNotification('Welcome to ProfitPilot! Start earning now! 🚀', 'success');
  };

  // Onboarding Modal
  const OnboardingModal = () => {
    const steps = [
      {
        title: "Welcome to ProfitPilot! 🚀",
        content: "Your journey to passive crypto earnings starts here. Let's show you around!",
        icon: "🎉"
      },
      {
        title: "Auto Mining System ⛏️",
        content: "Every 2 hours, your tokens automatically generate earnings. No manual work required!",
        icon: "⚡"
      },
      {
        title: "Your First Token 🪙",
        content: "You already have 1 free token earning $0.70 every 2 hours. You can own up to 5 tokens total.",
        icon: "🎁"
      },
      {
        title: "Boost for More Earnings 📈",
        content: "Boost tokens to double earnings: Level 1 = $1.40, Level 2 = $2.80, and so on!",
        icon: "🚀"
      },
      {
        title: "Referral Program 🤝",
        content: "Earn $2 for every friend you invite. Share your referral code and grow together!",
        icon: "💰"
      },
      {
        title: "6-Month Maturity ⏰",
        content: "Withdraw after 180 days. This ensures platform stability and your long-term gains.",
        icon: "🎯"
      }
    ];

    const currentStep = steps[onboardingStep];

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl max-w-md w-full p-8 text-center">
          <div className="text-6xl mb-4">{currentStep.icon}</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-4">{currentStep.title}</h2>
          <p className="text-gray-600 mb-8">{currentStep.content}</p>
          
          <div className="flex justify-center space-x-2 mb-6">
            {steps.map((_, index) => (
              <div
                key={index}
                className={`w-2 h-2 rounded-full ${index === onboardingStep ? 'bg-blue-600' : 'bg-gray-300'}`}
              />
            ))}
          </div>

          <div className="flex space-x-4">
            {onboardingStep > 0 && (
              <button
                onClick={() => setOnboardingStep(onboardingStep - 1)}
                className="flex-1 py-3 px-4 bg-gray-100 text-gray-700 rounded-lg font-medium"
              >
                Back
              </button>
            )}
            <button
              onClick={() => {
                if (onboardingStep < steps.length - 1) {
                  setOnboardingStep(onboardingStep + 1);
                } else {
                  completeOnboarding();
                }
              }}
              className="flex-1 py-3 px-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-medium"
            >
              {onboardingStep < steps.length - 1 ? 'Next' : 'Start Mining!'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Notification Component
  const NotificationContainer = () => (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {notifications.map(notification => (
        <div
          key={notification.id}
          className={`p-4 rounded-lg shadow-lg text-white max-w-sm ${
            notification.type === 'success' ? 'bg-green-500' :
            notification.type === 'error' ? 'bg-red-500' :
            notification.type === 'warning' ? 'bg-yellow-500' : 'bg-blue-500'
          }`}
        >
          {notification.message}
        </div>
      ))}
    </div>
  );

  // Mobile Menu Component
  const MobileMenu = () => (
    <div className={`fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden ${showMobileMenu ? 'block' : 'hidden'}`}>
      <div className="fixed inset-y-0 left-0 w-64 bg-white shadow-lg">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="bg-gradient-to-r from-blue-600 to-purple-600 w-8 h-8 rounded-full flex items-center justify-center">
                <span className="text-white text-sm font-bold">P</span>
              </div>
              <span className="ml-2 text-lg font-bold text-gray-800">ProfitPilot</span>
            </div>
            <button onClick={() => setShowMobileMenu(false)} className="text-gray-500">
              ✕
            </button>
          </div>
        </div>
        
        <nav className="p-4 space-y-2">
          {[
            { id: 'home', icon: '🏠', label: 'Dashboard', desc: 'Overview & stats' },
            { id: 'tokens', icon: '🪙', label: 'My Tokens', desc: 'Manage mining assets' },
            { id: 'boost', icon: '⚡', label: 'Boost Center', desc: 'Upgrade tokens' },
            { id: 'referrals', icon: '🤝', label: 'Referrals', desc: 'Invite friends' },
            { id: 'profile', icon: '👤', label: 'Profile', desc: 'Account settings' },
            { id: 'board', icon: '🏆', label: 'Leaderboard', desc: 'Top performers' },
            { id: 'help', icon: '❓', label: 'Help Center', desc: 'Learn & support' }
          ].map(item => (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id);
                setShowMobileMenu(false);
              }}
              className={`w-full text-left p-3 rounded-lg transition-colors ${
                activeTab === item.id ? 'bg-blue-50 text-blue-600' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center space-x-3">
                <span className="text-xl">{item.icon}</span>
                <div>
                  <div className="font-medium">{item.label}</div>
                  <div className="text-sm text-gray-500">{item.desc}</div>
                </div>
              </div>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );

  if (showAuth) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 to-purple-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
          <div className="text-center mb-8">
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-white text-2xl font-bold">P</span>
            </div>
            <h1 className="text-3xl font-bold text-gray-800">ProfitPilot</h1>
            <p className="text-gray-600 mt-2">Your crypto earnings platform</p>
            
            {/* Benefits showcase */}
            <div className="mt-6 space-y-2 text-sm text-gray-600">
              <div className="flex items-center justify-center space-x-2">
                <span>⛏️</span>
                <span>Auto mining every 2 hours</span>
              </div>
              <div className="flex items-center justify-center space-x-2">
                <span>💰</span>
                <span>Passive crypto earnings</span>
              </div>
              <div className="flex items-center justify-center space-x-2">
                <span>🚀</span>
                <span>Boost tokens for more profits</span>
              </div>
            </div>
          </div>

          <div className="flex mb-6">
            <button
              className={`flex-1 py-2 px-4 rounded-l-lg font-medium transition-colors ${authMode === 'login' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
              onClick={() => setAuthMode('login')}
            >
              Login
            </button>
            <button
              className={`flex-1 py-2 px-4 rounded-r-lg font-medium transition-colors ${authMode === 'register' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
              onClick={() => setAuthMode('register')}
            >
              Register
            </button>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <input
                type="email"
                placeholder="Email"
                value={authForm.email}
                onChange={(e) => setAuthForm({...authForm, email: e.target.value})}
                className="w-full p-4 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base"
                required
              />
            </div>
            <div>
              <input
                type="password"
                placeholder="Password"
                value={authForm.password}
                onChange={(e) => setAuthForm({...authForm, password: e.target.value})}
                className="w-full p-4 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base"
                required
              />
            </div>
            {authMode === 'register' && (
              <div>
                <input
                  type="text"
                  placeholder="Referral Code (Optional)"
                  value={authForm.referralCode}
                  onChange={(e) => setAuthForm({...authForm, referralCode: e.target.value})}
                  className="w-full p-4 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base"
                />
                <p className="text-xs text-gray-500 mt-1">Enter a friend's referral code to earn $2 bonus!</p>
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-4 rounded-lg font-medium hover:opacity-90 disabled:opacity-50 text-base"
            >
              {loading ? 'Processing...' : (authMode === 'login' ? 'Login' : 'Register & Start Mining')}
            </button>
          </form>

          {authMode === 'register' && (
            <div className="mt-6 p-4 bg-green-50 rounded-lg">
              <p className="text-sm text-green-700 text-center">
                🎁 <strong>Free Token:</strong> Get your first mining token absolutely free when you register!
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {showOnboarding && <OnboardingModal />}
      <NotificationContainer />
      <MobileMenu />

      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <button 
                onClick={() => setShowMobileMenu(true)}
                className="lg:hidden p-2 rounded-lg text-gray-600 hover:bg-gray-100"
              >
                ☰
              </button>
              
              <div className="flex items-center ml-2 lg:ml-0">
                <div className="bg-gradient-to-r from-blue-600 to-purple-600 w-10 h-10 rounded-full flex items-center justify-center">
                  <span className="text-white text-lg font-bold">P</span>
                </div>
                <span className="ml-3 text-xl font-bold text-gray-800">ProfitPilot</span>
                <span className="ml-2 text-xs bg-green-100 text-green-600 px-2 py-1 rounded-full font-medium">LIVE</span>
              </div>
            </div>

            <div className="flex items-center space-x-2 sm:space-x-4">
              {/* Mining countdown - visible on all screens */}
              {miningCountdown && (
                <div className="hidden sm:flex items-center space-x-2 bg-orange-50 rounded-lg px-3 py-1">
                  <span className="text-sm text-orange-600">Next:</span>
                  <span className="text-sm font-bold text-orange-600">{miningCountdown}</span>
                </div>
              )}

              <div className="hidden md:flex items-center space-x-2 bg-gray-50 rounded-lg px-3 py-1">
                <span className="text-sm text-gray-600">Balance:</span>
                <span className="text-sm font-bold text-green-600">{formatCurrency(currentUser?.total_earnings || 0)}</span>
              </div>
              
              <div className="hidden sm:flex items-center space-x-2 bg-blue-50 rounded-lg px-3 py-1">
                <span className="text-sm text-gray-600">Tokens:</span>
                <span className="text-sm font-bold text-blue-600">{currentUser?.tokens_owned || 0}/5</span>
              </div>

              <div className="hidden lg:block text-right">
                <div className="text-sm font-medium text-gray-800">{currentUser?.user_id}</div>
                <div className="text-xs text-gray-500">{currentUser?.email}</div>
              </div>

              <button
                onClick={handleLogout}
                className="bg-red-50 hover:bg-red-100 text-red-600 text-sm px-3 py-2 rounded-lg font-medium transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Desktop Navigation */}
      <nav className="bg-white border-b border-gray-200 hidden lg:block">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8">
            {[
              { id: 'home', icon: '🏠', label: 'Dashboard' },
              { id: 'tokens', icon: '🪙', label: 'My Tokens' },
              { id: 'boost', icon: '⚡', label: 'Boost Center' },
              { id: 'referrals', icon: '🤝', label: 'Referrals' },
              { id: 'profile', icon: '👤', label: 'Profile' },
              { id: 'board', icon: '🏆', label: 'Leaderboard' },
              { id: 'help', icon: '❓', label: 'Help' }
            ].map(tab => (
              <button
                key={tab.id}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.id 
                    ? 'border-blue-500 text-blue-600' 
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
            {currentUser?.is_admin && (
              <button
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'admin' 
                    ? 'border-blue-500 text-blue-600' 
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
                onClick={() => setActiveTab('admin')}
              >
                ⚙️ Admin
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Mobile Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 lg:hidden z-20">
        <div className="grid grid-cols-5 gap-1">
          {[
            { id: 'home', icon: '🏠', label: 'Home' },
            { id: 'tokens', icon: '🪙', label: 'Tokens' },
            { id: 'boost', icon: '⚡', label: 'Boost' },
            { id: 'profile', icon: '👤', label: 'Profile' },
            { id: 'help', icon: '❓', label: 'Help' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-2 px-1 text-center transition-colors ${
                activeTab === tab.id ? 'text-blue-600' : 'text-gray-500'
              }`}
            >
              <div className="text-lg">{tab.icon}</div>
              <div className="text-xs font-medium">{tab.label}</div>
            </button>
          ))}
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-20 lg:pb-6">
        {activeTab === 'home' && dashboardData && (
          <div className="space-y-6">
            {/* Welcome Header */}
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl text-white p-6 sm:p-8">
              <div className="flex flex-col lg:flex-row justify-between items-start">
                <div className="w-full lg:w-auto">
                  <h1 className="text-2xl sm:text-3xl font-bold mb-2">Welcome Back! 👋</h1>
                  <p className="text-blue-100 mb-6">Here's your portfolio performance</p>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 lg:gap-8">
                    <div>
                      <p className="text-blue-200 text-sm mb-1">Total Balance</p>
                      <p className="text-2xl sm:text-4xl font-bold">{formatCurrency(dashboardData.stats.total_balance)}</p>
                    </div>
                    <div>
                      <p className="text-blue-200 text-sm mb-1">Active Assets</p>
                      <p className="text-2xl sm:text-4xl font-bold">{dashboardData.stats.active_assets}</p>
                    </div>
                  </div>
                </div>
                
                <div className="mt-4 lg:mt-0 text-right">
                  <div className="bg-white bg-opacity-20 rounded-lg p-3">
                    <span className="text-2xl">✨</span>
                  </div>
                </div>
              </div>

              {/* Mining Timer - Mobile */}
              {miningCountdown && (
                <div className="mt-6 sm:hidden bg-white bg-opacity-20 rounded-lg p-3 text-center">
                  <p className="text-blue-100 text-sm">Next Mining</p>
                  <p className="text-lg font-bold">{miningCountdown}</p>
                </div>
              )}
            </div>

            {/* Quick Actions - Mobile */}
            <div className="grid grid-cols-2 gap-4 sm:hidden">
              <button
                onClick={() => setActiveTab('tokens')}
                className="bg-white rounded-xl p-4 text-center shadow-sm border"
              >
                <div className="text-2xl mb-2">🪙</div>
                <div className="text-sm font-medium text-gray-800">My Tokens</div>
              </button>
              <button
                onClick={() => setActiveTab('boost')}
                className="bg-white rounded-xl p-4 text-center shadow-sm border"
              >
                <div className="text-2xl mb-2">⚡</div>
                <div className="text-sm font-medium text-gray-800">Boost</div>
              </button>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
              <div className="bg-green-50 rounded-xl p-4 lg:p-6">
                <div className="flex items-center justify-between mb-2 lg:mb-4">
                  <div className="bg-green-500 rounded-lg p-2">
                    <span className="text-white text-sm lg:text-lg">💰</span>
                  </div>
                  <span className="text-green-600 text-xs font-medium hidden lg:block">+2.5%</span>
                </div>
                <p className="text-gray-600 text-xs lg:text-sm mb-1">Total Earnings</p>
                <p className="text-lg lg:text-2xl font-bold text-gray-800">{formatCurrency(currentUser.total_earnings)}</p>
              </div>

              <div className="bg-blue-50 rounded-xl p-4 lg:p-6">
                <div className="flex items-center justify-between mb-2 lg:mb-4">
                  <div className="bg-blue-500 rounded-lg p-2">
                    <span className="text-white text-sm lg:text-lg">🔗</span>
                  </div>
                  <span className="text-blue-600 text-xs font-medium">{currentUser.tokens_owned}/5</span>
                </div>
                <p className="text-gray-600 text-xs lg:text-sm mb-1">Active Tokens</p>
                <p className="text-lg lg:text-2xl font-bold text-gray-800">{currentUser.tokens_owned}</p>
              </div>

              <div className="bg-purple-50 rounded-xl p-4 lg:p-6">
                <div className="flex items-center justify-between mb-2 lg:mb-4">
                  <div className="bg-purple-500 rounded-lg p-2">
                    <span className="text-white text-sm lg:text-lg">👥</span>
                  </div>
                  <span className="text-purple-600 text-xs font-medium hidden lg:block">{formatCurrency(currentUser.referral_earnings)} earned</span>
                </div>
                <p className="text-gray-600 text-xs lg:text-sm mb-1">Referrals</p>
                <p className="text-lg lg:text-2xl font-bold text-gray-800">{currentUser.referrals_count}</p>
              </div>

              <div className="bg-orange-50 rounded-xl p-4 lg:p-6">
                <div className="flex items-center justify-between mb-2 lg:mb-4">
                  <div className="bg-orange-500 rounded-lg p-2">
                    <span className="text-white text-sm lg:text-lg">⚡</span>
                  </div>
                  <span className="text-orange-600 text-xs font-medium">Total</span>
                </div>
                <p className="text-gray-600 text-xs lg:text-sm mb-1">Boosts Used</p>
                <p className="text-lg lg:text-2xl font-bold text-gray-800">{currentUser.boosts_used}</p>
              </div>
            </div>

            {/* Referral Section */}
            <div className="bg-white rounded-xl shadow-sm p-4 lg:p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">🤝 Referral Program</h3>
              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <p className="text-sm text-gray-600 mb-2">Your referral code:</p>
                <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-2">
                  <code className="bg-gray-200 px-3 py-2 rounded text-sm font-mono flex-1">{currentUser.referral_code}</code>
                  <button
                    onClick={copyReferralLink}
                    className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 transition-colors"
                  >
                    Copy Link
                  </button>
                </div>
              </div>
              <p className="text-sm text-gray-600">Earn $2 for each person who joins with your code!</p>
            </div>

            {/* Withdrawal Timer */}
            <div className="bg-white rounded-xl shadow-sm p-4 lg:p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">💸 Withdrawal Status</h3>
              <div className="bg-yellow-50 rounded-lg p-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                  <div className="mb-2 sm:mb-0">
                    <p className="font-medium text-gray-800">Time until withdrawal eligible:</p>
                    <p className="text-xl lg:text-2xl font-bold text-yellow-600">{formatTimeUntilWithdrawal(currentUser.withdrawal_eligible_at)}</p>
                  </div>
                  <div className="text-yellow-500 text-2xl lg:text-3xl text-right">⏰</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {(activeTab === 'tokens' || activeTab === 'boost') && dashboardData && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
              <h2 className="text-2xl font-bold text-gray-800 mb-2 sm:mb-0">
                {activeTab === 'tokens' ? '🪙 Your Tokens' : '⚡ Boost Center'}
              </h2>
              <p className="text-gray-600">
                {activeTab === 'tokens' ? 'Manage your mining tokens' : 'Upgrade tokens for higher earnings'}
              </p>
            </div>

            {/* How it works explanation */}
            <div className="bg-blue-50 rounded-xl p-4 lg:p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-2">
                {activeTab === 'tokens' ? '⛏️ How Mining Works' : '🚀 How Boosting Works'}
              </h3>
              <p className="text-gray-600 text-sm mb-4">
                {activeTab === 'tokens' 
                  ? 'Your tokens automatically mine every 2 hours. Base earning is $0.70 per token per cycle.'
                  : 'Boosting doubles your earnings per level. Level 1 = $1.40, Level 2 = $2.80, Level 3 = $5.60, etc.'
                }
              </p>
              
              {activeTab === 'boost' && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-center">
                  <div className="bg-white rounded-lg p-3">
                    <div className="text-sm font-medium text-gray-800">Level 0</div>
                    <div className="text-lg font-bold text-green-600">$0.70</div>
                  </div>
                  <div className="bg-white rounded-lg p-3">
                    <div className="text-sm font-medium text-gray-800">Level 1</div>
                    <div className="text-lg font-bold text-green-600">$1.40</div>
                  </div>
                  <div className="bg-white rounded-lg p-3">
                    <div className="text-sm font-medium text-gray-800">Level 2</div>
                    <div className="text-lg font-bold text-green-600">$2.80</div>
                  </div>
                  <div className="bg-white rounded-lg p-3">
                    <div className="text-sm font-medium text-gray-800">Level 3</div>
                    <div className="text-lg font-bold text-green-600">$5.60</div>
                  </div>
                </div>
              )}
            </div>

            {currentUser.tokens_owned < 5 && activeTab === 'tokens' && (
              <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-xl p-4 lg:p-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-2">➕ Add More Tokens</h3>
                <p className="text-gray-600 mb-4">Expand your mining capacity with additional tokens ($5 each)</p>
                <button
                  onClick={() => handlePayment('token')}
                  disabled={loading}
                  className="w-full sm:w-auto bg-gradient-to-r from-green-500 to-blue-500 text-white px-6 py-3 rounded-lg font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  + Add Token ($5)
                </button>
              </div>
            )}

            <div className="grid gap-4 lg:gap-6">
              {dashboardData.tokens.map((token, index) => (
                <div key={token.token_id} className="bg-white rounded-xl shadow-sm p-4 lg:p-6">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start mb-4">
                    <div className="mb-2 sm:mb-0">
                      <h3 className="text-lg font-semibold text-gray-800">{token.name}</h3>
                      <p className="text-sm text-gray-500">Created: {new Date(token.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-sm text-gray-500">Boost Level</p>
                      <p className="text-2xl font-bold text-blue-600">{token.boost_level}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                    <div>
                      <p className="text-sm text-gray-500">Total Earned</p>
                      <p className="text-lg font-semibold text-green-600">{formatCurrency(token.total_earnings)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Per Cycle (2h)</p>
                      <p className="text-lg font-semibold text-blue-600">{formatCurrency(0.70 * Math.pow(2, token.boost_level))}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Boost Cost</p>
                      <p className="text-lg font-semibold text-orange-600">{formatCurrency(3 * Math.pow(2, token.boost_level))}</p>
                    </div>
                  </div>

                  <button
                    onClick={() => handlePayment('boost', token.token_id)}
                    disabled={loading}
                    className="w-full bg-gradient-to-r from-orange-500 to-red-500 text-white py-3 rounded-lg font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    ⚡ Boost Token ({formatCurrency(3 * Math.pow(2, token.boost_level))})
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'referrals' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
              <h2 className="text-2xl font-bold text-gray-800 mb-2 sm:mb-0">🤝 Referral Program</h2>
              <p className="text-gray-600">Earn $2 for every friend you invite</p>
            </div>

            {/* How referrals work */}
            <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl p-4 lg:p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">💰 How It Works</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="bg-white rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-2">
                    <span className="text-2xl">📤</span>
                  </div>
                  <h4 className="font-medium text-gray-800">1. Share Your Code</h4>
                  <p className="text-sm text-gray-600">Send your unique referral code to friends</p>
                </div>
                <div className="text-center">
                  <div className="bg-white rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-2">
                    <span className="text-2xl">👥</span>
                  </div>
                  <h4 className="font-medium text-gray-800">2. They Register</h4>
                  <p className="text-sm text-gray-600">Friend joins using your referral code</p>
                </div>
                <div className="text-center">
                  <div className="bg-white rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-2">
                    <span className="text-2xl">💰</span>
                  </div>
                  <h4 className="font-medium text-gray-800">3. Both Earn $2</h4>
                  <p className="text-sm text-gray-600">You both get $2 instantly added</p>
                </div>
              </div>
            </div>

            {/* Referral stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl p-4 text-center">
                <div className="text-2xl mb-2">👥</div>
                <div className="text-2xl font-bold text-blue-600">{currentUser?.referrals_count || 0}</div>
                <div className="text-sm text-gray-600">Total Referrals</div>
              </div>
              <div className="bg-white rounded-xl p-4 text-center">
                <div className="text-2xl mb-2">💰</div>
                <div className="text-2xl font-bold text-green-600">{formatCurrency(currentUser?.referral_earnings || 0)}</div>
                <div className="text-sm text-gray-600">Earned</div>
              </div>
              <div className="bg-white rounded-xl p-4 text-center">
                <div className="text-2xl mb-2">📈</div>
                <div className="text-2xl font-bold text-purple-600">{formatCurrency((currentUser?.referrals_count || 0) * 2)}</div>
                <div className="text-sm text-gray-600">Potential</div>
              </div>
              <div className="bg-white rounded-xl p-4 text-center">
                <div className="text-2xl mb-2">🎯</div>
                <div className="text-2xl font-bold text-orange-600">∞</div>
                <div className="text-sm text-gray-600">Unlimited</div>
              </div>
            </div>

            {/* Share section */}
            <div className="bg-white rounded-xl shadow-sm p-4 lg:p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">📤 Share Your Code</h3>
              <div className="space-y-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm text-gray-600 mb-2">Your referral code:</p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <code className="bg-white border px-4 py-3 rounded text-lg font-mono flex-1 text-center">{currentUser?.referral_code}</code>
                    <button
                      onClick={copyReferralLink}
                      className="bg-blue-600 text-white px-6 py-3 rounded font-medium hover:bg-blue-700 transition-colors"
                    >
                      📋 Copy Link
                    </button>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button className="flex items-center justify-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded text-sm">
                    <span>📘</span>
                    <span>Facebook</span>
                  </button>
                  <button className="flex items-center justify-center space-x-2 bg-blue-400 text-white px-4 py-2 rounded text-sm">
                    <span>🐦</span>
                    <span>Twitter</span>
                  </button>
                  <button className="flex items-center justify-center space-x-2 bg-green-600 text-white px-4 py-2 rounded text-sm">
                    <span>💬</span>
                    <span>WhatsApp</span>
                  </button>
                  <button className="flex items-center justify-center space-x-2 bg-blue-700 text-white px-4 py-2 rounded text-sm">
                    <span>💼</span>
                    <span>LinkedIn</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
              <h2 className="text-2xl font-bold text-gray-800 mb-2 sm:mb-0">👤 Profile</h2>
              <p className="text-gray-600">Manage your account and settings</p>
            </div>

            {/* Profile sub-navigation */}
            <div className="bg-white rounded-xl shadow-sm">
              <div className="flex flex-wrap border-b">
                {[
                  { id: 'account', label: 'Account', icon: '👤' },
                  { id: 'security', label: 'Security', icon: '🔐' },
                  { id: 'transactions', label: 'Transactions', icon: '💳' },
                  { id: 'settings', label: 'Settings', icon: '⚙️' }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setProfileSubTab(tab.id)}
                    className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                      profileSubTab === tab.id
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {tab.icon} {tab.label}
                  </button>
                ))}
              </div>

              <div className="p-4 lg:p-6">
                {profileSubTab === 'account' && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold text-gray-800">Account Information</h3>
                    
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">User ID</label>
                        <input
                          type="text"
                          value={currentUser?.user_id || ''}
                          disabled
                          className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                        <input
                          type="email"
                          value={currentUser?.email || ''}
                          disabled
                          className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Member Since</label>
                        <input
                          type="text"
                          value={currentUser?.created_at ? new Date(currentUser.created_at).toLocaleDateString() : ''}
                          disabled
                          className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Referral Code</label>
                        <input
                          type="text"
                          value={currentUser?.referral_code || ''}
                          disabled
                          className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50"
                        />
                      </div>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-4">
                      <h4 className="font-medium text-gray-800 mb-2">Account Stats</h4>
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-center">
                        <div>
                          <div className="text-2xl font-bold text-green-600">{formatCurrency(currentUser?.total_earnings || 0)}</div>
                          <div className="text-sm text-gray-600">Total Earnings</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-blue-600">{currentUser?.tokens_owned || 0}</div>
                          <div className="text-sm text-gray-600">Tokens Owned</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-purple-600">{currentUser?.referrals_count || 0}</div>
                          <div className="text-sm text-gray-600">Referrals</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-orange-600">{currentUser?.boosts_used || 0}</div>
                          <div className="text-sm text-gray-600">Boosts Used</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {profileSubTab === 'security' && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold text-gray-800">Security Settings</h3>
                    
                    <form onSubmit={handlePasswordChange} className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Current Password</label>
                        <input
                          type="password"
                          value={profileForm.currentPassword}
                          onChange={(e) => setProfileForm({...profileForm, currentPassword: e.target.value})}
                          className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">New Password</label>
                        <input
                          type="password"
                          value={profileForm.newPassword}
                          onChange={(e) => setProfileForm({...profileForm, newPassword: e.target.value})}
                          className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Confirm New Password</label>
                        <input
                          type="password"
                          value={profileForm.confirmPassword}
                          onChange={(e) => setProfileForm({...profileForm, confirmPassword: e.target.value})}
                          className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={loading}
                        className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        {loading ? 'Updating...' : 'Update Password'}
                      </button>
                    </form>

                    <div className="bg-yellow-50 rounded-lg p-4">
                      <h4 className="font-medium text-gray-800 mb-2">🔐 Account Security</h4>
                      <p className="text-sm text-gray-600">
                        Your account is secured with industry-standard encryption. 
                        We recommend using a strong, unique password and enabling two-factor authentication when available.
                      </p>
                    </div>
                  </div>
                )}

                {profileSubTab === 'transactions' && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold text-gray-800">Transaction History</h3>
                    
                    <div className="bg-gray-50 rounded-lg p-4 text-center">
                      <div className="text-4xl mb-2">💳</div>
                      <p className="text-gray-600">Transaction history feature coming soon!</p>
                      <p className="text-sm text-gray-500 mt-2">
                        You'll be able to view all your payments, mining earnings, and referral bonuses here.
                      </p>
                    </div>

                    <div className="bg-blue-50 rounded-lg p-4">
                      <h4 className="font-medium text-gray-800 mb-2">📊 Quick Stats</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="text-center">
                          <div className="text-xl font-bold text-green-600">{formatCurrency(currentUser?.total_earnings || 0)}</div>
                          <div className="text-sm text-gray-600">Total Earned</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xl font-bold text-purple-600">{formatCurrency(currentUser?.referral_earnings || 0)}</div>
                          <div className="text-sm text-gray-600">From Referrals</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {profileSubTab === 'settings' && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold text-gray-800">App Settings</h3>
                    
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div>
                          <h4 className="font-medium text-gray-800">🌙 Dark Mode</h4>
                          <p className="text-sm text-gray-600">Switch to dark theme</p>
                        </div>
                        <button className="bg-gray-300 rounded-full w-12 h-6 relative">
                          <div className="bg-white w-5 h-5 rounded-full absolute top-0.5 left-0.5 transition-transform"></div>
                        </button>
                      </div>

                      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div>
                          <h4 className="font-medium text-gray-800">🔔 Notifications</h4>
                          <p className="text-sm text-gray-600">Mining and referral alerts</p>
                        </div>
                        <button className="bg-blue-600 rounded-full w-12 h-6 relative">
                          <div className="bg-white w-5 h-5 rounded-full absolute top-0.5 right-0.5 transition-transform"></div>
                        </button>
                      </div>

                      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div>
                          <h4 className="font-medium text-gray-800">💰 Currency Display</h4>
                          <p className="text-sm text-gray-600">Show amounts in USD</p>
                        </div>
                        <select className="bg-white border border-gray-300 rounded px-3 py-1 text-sm">
                          <option value="USD">USD ($)</option>
                          <option value="NGN">NGN (₦)</option>
                        </select>
                      </div>
                    </div>

                    <div className="bg-red-50 rounded-lg p-4">
                      <h4 className="font-medium text-red-800 mb-2">⚠️ Danger Zone</h4>
                      <p className="text-sm text-red-600 mb-4">
                        Once you delete your account, there is no going back. Please be certain.
                      </p>
                      <button className="bg-red-600 text-white px-4 py-2 rounded text-sm hover:bg-red-700 transition-colors">
                        Delete Account
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'help' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
              <h2 className="text-2xl font-bold text-gray-800 mb-2 sm:mb-0">❓ Help Center</h2>
              <p className="text-gray-600">Everything you need to know about ProfitPilot</p>
            </div>

            {/* Quick start button */}
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-4 lg:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                <div className="mb-4 sm:mb-0">
                  <h3 className="text-lg font-semibold text-gray-800">🚀 New to ProfitPilot?</h3>
                  <p className="text-gray-600">Take our quick tour to learn the basics</p>
                </div>
                <button
                  onClick={() => setShowOnboarding(true)}
                  className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-3 rounded-lg font-medium hover:opacity-90 transition-opacity"
                >
                  Take Tour Again
                </button>
              </div>
            </div>

            {/* FAQ Sections */}
            <div className="grid gap-6">
              <div className="bg-white rounded-xl shadow-sm p-4 lg:p-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">⛏️ Mining System</h3>
                <div className="space-y-4">
                  <div className="border-l-4 border-blue-500 pl-4">
                    <h4 className="font-medium text-gray-800">How does mining work?</h4>
                    <p className="text-sm text-gray-600">Your tokens automatically generate earnings every 2 hours. No manual work required - it's completely passive!</p>
                  </div>
                  <div className="border-l-4 border-green-500 pl-4">
                    <h4 className="font-medium text-gray-800">How much can I earn?</h4>
                    <p className="text-sm text-gray-600">Base earning is $0.70 per token every 2 hours. With 5 boosted tokens, you could earn over $500 per month!</p>
                  </div>
                  <div className="border-l-4 border-purple-500 pl-4">
                    <h4 className="font-medium text-gray-800">When does mining happen?</h4>
                    <p className="text-sm text-gray-600">Mining occurs automatically every 2 hours, 24/7. Check the countdown timer to see when your next mining cycle begins.</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm p-4 lg:p-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">🚀 Boosting Tokens</h3>
                <div className="space-y-4">
                  <div className="border-l-4 border-orange-500 pl-4">
                    <h4 className="font-medium text-gray-800">What is boosting?</h4>
                    <p className="text-sm text-gray-600">Boosting doubles your token's earning power. Each boost level multiplies earnings: Level 1 = $1.40, Level 2 = $2.80, etc.</p>
                  </div>
                  <div className="border-l-4 border-red-500 pl-4">
                    <h4 className="font-medium text-gray-800">How much does boosting cost?</h4>
                    <p className="text-sm text-gray-600">Boost cost doubles each level: Level 1 = $3, Level 2 = $6, Level 3 = $12, Level 4 = $24, etc.</p>
                  </div>
                  <div className="border-l-4 border-yellow-500 pl-4">
                    <h4 className="font-medium text-gray-800">Is boosting worth it?</h4>
                    <p className="text-sm text-gray-600">Yes! Higher boost levels pay for themselves quickly and generate significantly more long-term earnings.</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm p-4 lg:p-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">💰 Payments & Withdrawals</h3>
                <div className="space-y-4">
                  <div className="border-l-4 border-blue-500 pl-4">
                    <h4 className="font-medium text-gray-800">When can I withdraw?</h4>
                    <p className="text-sm text-gray-600">Withdrawals are available after 180 days (6 months) from registration. This ensures platform stability.</p>
                  </div>
                  <div className="border-l-4 border-green-500 pl-4">
                    <h4 className="font-medium text-gray-800">How do I pay for tokens/boosts?</h4>
                    <p className="text-sm text-gray-600">We use Paystack for secure payments. You can pay with cards, bank transfers, and other local payment methods.</p>
                  </div>
                  <div className="border-l-4 border-purple-500 pl-4">
                    <h4 className="font-medium text-gray-800">Are my payments secure?</h4>
                    <p className="text-sm text-gray-600">Yes! All payments are processed through Paystack's secure, PCI-compliant infrastructure.</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm p-4 lg:p-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">🤝 Referral Program</h3>
                <div className="space-y-4">
                  <div className="border-l-4 border-pink-500 pl-4">
                    <h4 className="font-medium text-gray-800">How much do I earn per referral?</h4>
                    <p className="text-sm text-gray-600">You earn $2 for every person who registers using your referral code. They also get $2 as a welcome bonus!</p>
                  </div>
                  <div className="border-l-4 border-teal-500 pl-4">
                    <h4 className="font-medium text-gray-800">How do I share my referral code?</h4>
                    <p className="text-sm text-gray-600">Copy your referral link from the dashboard or referrals page and share it on social media, messaging apps, or via email.</p>
                  </div>
                  <div className="border-l-4 border-indigo-500 pl-4">
                    <h4 className="font-medium text-gray-800">Is there a referral limit?</h4>
                    <p className="text-sm text-gray-600">No! You can refer unlimited people and earn $2 for each successful referral.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Contact section */}
            <div className="bg-gradient-to-r from-gray-50 to-blue-50 rounded-xl p-4 lg:p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">📞 Need More Help?</h3>
              <p className="text-gray-600 mb-4">Can't find what you're looking for? Get in touch with our support team.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button className="flex items-center justify-center space-x-2 bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 transition-colors">
                  <span>📧</span>
                  <span>Email Support</span>
                </button>
                <button className="flex items-center justify-center space-x-2 bg-green-600 text-white px-4 py-3 rounded-lg hover:bg-green-700 transition-colors">
                  <span>💬</span>
                  <span>Live Chat</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'board' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-800">🏆 Leaderboard</h2>
            
            {leaderboardData ? (
              <div className="grid lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-xl shadow-sm p-4 lg:p-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">💰 Top Earners</h3>
                  <div className="space-y-3">
                    {leaderboardData.top_earners.map((user, index) => (
                      <div key={user.user_id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center space-x-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm ${
                            index === 0 ? 'bg-yellow-500' : 
                            index === 1 ? 'bg-gray-400' : 
                            index === 2 ? 'bg-orange-600' : 'bg-gray-300'
                          }`}>
                            {index + 1}
                          </div>
                          <div>
                            <p className="font-medium text-sm">{user.user_id}</p>
                            <p className="text-xs text-gray-500">{user.email}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-green-600 text-sm">{formatCurrency(user.total_earnings)}</p>
                          <p className="text-xs text-gray-500">{user.tokens_owned} tokens</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm p-4 lg:p-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">⚡ Most Boosted Tokens</h3>
                  <div className="space-y-3">
                    {leaderboardData.top_tokens.map((token, index) => (
                      <div key={token.name} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center space-x-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm ${
                            index === 0 ? 'bg-yellow-500' : 
                            index === 1 ? 'bg-gray-400' : 
                            index === 2 ? 'bg-orange-600' : 'bg-gray-300'
                          }`}>
                            {index + 1}
                          </div>
                          <div>
                            <p className="font-medium text-sm">{token.name}</p>
                            <p className="text-xs text-gray-500">Owner: {token.owner_id}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-blue-600 text-sm">Level {token.boost_level}</p>
                          <p className="text-xs text-gray-500">{formatCurrency(token.total_earnings)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="text-4xl mb-4">🏆</div>
                <p className="text-gray-500">Loading leaderboard...</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'admin' && currentUser?.is_admin && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-800">⚙️ Admin Panel</h2>
            
            {adminStats ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
                <div className="bg-white rounded-xl shadow-sm p-4 lg:p-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">Total Users</h3>
                  <p className="text-2xl lg:text-3xl font-bold text-blue-600">{adminStats.total_users}</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm p-4 lg:p-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">Total Tokens</h3>
                  <p className="text-2xl lg:text-3xl font-bold text-green-600">{adminStats.total_tokens}</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm p-4 lg:p-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">Transactions</h3>
                  <p className="text-2xl lg:text-3xl font-bold text-orange-600">{adminStats.total_transactions}</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm p-4 lg:p-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">Platform Earnings</h3>
                  <p className="text-xl lg:text-3xl font-bold text-purple-600">{formatCurrency(adminStats.total_platform_earnings)}</p>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="text-4xl mb-4">⚙️</div>
                <p className="text-gray-500">Loading admin stats...</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
