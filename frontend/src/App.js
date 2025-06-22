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
  const [lastEarnings, setLastEarnings] = useState(0); // Track earnings changes

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

  // Auto-refresh dashboard data every 60 seconds
  useEffect(() => {
    if (!showAuth && currentUser) {
      const interval = setInterval(() => {
        fetchDashboard(); // Refresh data every minute
      }, 60000); // 60 seconds

      return () => clearInterval(interval);
    }
  }, [showAuth, currentUser]);

  // Check for earnings changes and show notification
  useEffect(() => {
    if (currentUser && lastEarnings > 0 && currentUser.total_earnings > lastEarnings) {
      const difference = currentUser.total_earnings - lastEarnings;
      showNotification(`🎉 Mining completed! You earned $${difference.toFixed(2)}!`, 'success');
    }
    if (currentUser) {
      setLastEarnings(currentUser.total_earnings);
    }
  }, [currentUser?.total_earnings]);

  // Mining countdown timer
  useEffect(() => {
    if (dashboardData?.next_mining) {
      const timer = setInterval(() => {
        const now = new Date();
        const nextMining = new Date(dashboardData.next_mining);
        const diff = nextMining - now;
        
        if (diff <= 0) {
          setMiningCountdown('Mining now! 🎉');
          // Refresh data when mining should be happening
          setTimeout(() => fetchDashboard(), 5000);
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
      showNotification('Password change feature coming soon!', 'info');
    } catch (error) {
      showNotification('Password change failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Manual mining trigger for admins
  const triggerMining = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('profitpilot_token');
      await axios.post(
        `${BACKEND_URL}/api/admin/trigger-mining`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      showNotification('Mining triggered successfully! 🎉', 'success');
      // Refresh dashboard after a few seconds
      setTimeout(() => fetchDashboard(), 3000);
    } catch (error) {
      showNotification(error.response?.data?.detail || 'Failed to trigger mining', 'error');
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

  // Onboarding Modal (same as before...)
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

  // Mobile Menu Component (same as before...)
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
                
                {/* Auto-refresh indicator */}
                <div className="ml-2 flex items-center space-x-1">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-xs text-gray-500 hidden sm:block">Auto-refresh</span>
                </div>
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

              {/* Admin mining trigger button */}
              {currentUser?.is_admin && (
                <button
                  onClick={triggerMining}
                  disabled={loading}
                  className="hidden lg:flex items-center space-x-1 bg-purple-50 hover:bg-purple-100 text-purple-600 text-sm px-3 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  <span>⛏️</span>
                  <span>Mine Now</span>
                </button>
              )}

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

      {/* Main Content - (rest of your components remain the same but with mining countdown and refresh indicators...) */}
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

              {/* Auto-refresh indicator */}
              <div className="mt-4 flex items-center justify-center sm:justify-start space-x-2 text-blue-100 text-sm">
                <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                <span>Updates automatically every minute</span>
              </div>
            </div>

            {/* Admin Controls */}
            {currentUser?.is_admin && (
              <div className="bg-purple-50 rounded-xl p-4 lg:p-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">🔧 Admin Controls</h3>
                <div className="flex flex-col sm:flex-row gap-4">
                  <button
                    onClick={triggerMining}
                    disabled={loading}
                    className="flex items-center justify-center space-x-2 bg-purple-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors"
                  >
                    <span>⛏️</span>
                    <span>{loading ? 'Mining...' : 'Trigger Mining Now'}</span>
                  </button>
                  <button
                    onClick={() => fetchDashboard()}
                    className="flex items-center justify-center space-x-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                  >
                    <span>🔄</span>
                    <span>Refresh Data</span>
                  </button>
                </div>
              </div>
            )}

            {/* Rest of your home content... */}
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
                  <span className="text-green-600 text-xs font-medium hidden lg:block">Auto-updating</span>
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

        {/* Add all your other tab content here with the same structure... */}
        {/* For brevity, I'm showing just the main home tab - include all other tabs from the previous code */}
        
      </main>
    </div>
  );
}

export default App;
