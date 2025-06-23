import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

// Get backend URL from environment
const BACKEND_URL = process.env.REACT_APP_API_URL || 'http://localhost:8001';

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState('home');
  const [profileSubTab, setProfileSubTab] = useState('account');
  const [adminSubTab, setAdminSubTab] = useState('overview');
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [leaderboardData, setLeaderboardData] = useState(null);
  const [adminStats, setAdminStats] = useState(null);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminTasks, setAdminTasks] = useState([]);
  const [adminBroadcasts, setAdminBroadcasts] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [miningCountdown, setMiningCountdown] = useState('');
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [userNotifications, setUserNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [lastEarnings, setLastEarnings] = useState(0);
  const [userTasks, setUserTasks] = useState([]);

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

  // Admin forms
  const [sendBalanceForm, setSendBalanceForm] = useState({
    user_id: '',
    amount: '',
    reason: ''
  });

  const [createTaskForm, setCreateTaskForm] = useState({
    title: '',
    description: '',
    reward: '',
    type: 'one_time',
    requirements: '',
    expires_at: ''
  });

  const [giveBoostForm, setGiveBoostForm] = useState({
    user_id: '',
    token_id: '',
    boost_levels: 1,
    reason: ''
  });

  const [broadcastForm, setBroadcastForm] = useState({
    title: '',
    message: '',
    type: 'info',
    priority: 'medium'
  });

  // Check for existing token and handle referral on app load
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const referralCode = urlParams.get('ref');
    if (referralCode) {
      setAuthForm(prev => ({ ...prev, referralCode }));
      setAuthMode('register');
    }

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
        fetchDashboard();
        fetchUserNotifications();
      }, 60000);

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
      
      if (response.data.user.tokens_owned === 1 && !localStorage.getItem('onboarding_completed')) {
        setShowOnboarding(true);
      }

      // Fetch notifications for users
      if (!response.data.user.is_admin) {
        fetchUserNotifications(authToken);
        fetchUserTasks(authToken);
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

  const fetchUserNotifications = async (token = null) => {
    try {
      const authToken = token || localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/notifications`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      setUserNotifications(response.data.notifications);
      setUnreadCount(response.data.unread_count);
    } catch (error) {
      console.error('Notifications fetch error:', error);
    }
  };

  const fetchUserTasks = async (token = null) => {
    try {
      const authToken = token || localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/tasks`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      setUserTasks(response.data.tasks);
    } catch (error) {
      console.error('Tasks fetch error:', error);
    }
  };

  const markNotificationRead = async (notificationId) => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      await axios.post(`${BACKEND_URL}/api/notifications/${notificationId}/read`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchUserNotifications();
    } catch (error) {
      console.error('Mark notification read error:', error);
    }
  };

  const completeTask = async (taskId) => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.post(`${BACKEND_URL}/api/tasks/complete`, 
        { task_id: taskId },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      showNotification(response.data.message, 'success');
      fetchUserTasks();
      fetchDashboard();
    } catch (error) {
      showNotification(error.response?.data?.detail || 'Failed to complete task', 'error');
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
      
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (error) {
      showNotification('Payment verification failed', 'error');
    }
  };

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
      setTimeout(() => fetchDashboard(), 3000);
    } catch (error) {
      showNotification(error.response?.data?.detail || 'Failed to trigger mining', 'error');
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // ADMIN FUNCTIONS
  // ============================================================================

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

  const fetchAdminUsers = async () => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/admin/users`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAdminUsers(response.data.users);
    } catch (error) {
      console.error('Admin users fetch error:', error);
    }
  };

  const fetchUserDetails = async (userId) => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/admin/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSelectedUser(response.data);
    } catch (error) {
      console.error('User details fetch error:', error);
    }
  };

  const fetchAdminTasks = async () => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/admin/tasks`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAdminTasks(response.data.tasks);
    } catch (error) {
      console.error('Admin tasks fetch error:', error);
    }
  };

  const fetchAdminBroadcasts = async () => {
    try {
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.get(`${BACKEND_URL}/api/admin/broadcasts`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAdminBroadcasts(response.data.broadcasts);
    } catch (error) {
      console.error('Admin broadcasts fetch error:', error);
    }
  };

  const handleSendBalance = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.post(`${BACKEND_URL}/api/admin/send-balance`, sendBalanceForm, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showNotification(response.data.message, 'success');
      setSendBalanceForm({ user_id: '', amount: '', reason: '' });
      fetchAdminUsers();
    } catch (error) {
      showNotification(error.response?.data?.detail || 'Failed to send balance', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTask = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      const token = localStorage.getItem('profitpilot_token');
      const taskData = {
        ...createTaskForm,
        reward: parseFloat(createTaskForm.reward),
        expires_at: createTaskForm.expires_at ? new Date(createTaskForm.expires_at).toISOString() : null
      };
      const response = await axios.post(`${BACKEND_URL}/api/admin/create-task`, taskData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showNotification(response.data.message, 'success');
      setCreateTaskForm({ title: '', description: '', reward: '', type: 'one_time', requirements: '', expires_at: '' });
      fetchAdminTasks();
    } catch (error) {
      showNotification(error.response?.data?.detail || 'Failed to create task', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleGiveBoost = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      const token = localStorage.getItem('profitpilot_token');
      const boostData = {
        ...giveBoostForm,
        boost_levels: parseInt(giveBoostForm.boost_levels)
      };
      const response = await axios.post(`${BACKEND_URL}/api/admin/give-boost`, boostData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showNotification(response.data.message, 'success');
      setGiveBoostForm({ user_id: '', token_id: '', boost_levels: 1, reason: '' });
      fetchAdminUsers();
    } catch (error) {
      showNotification(error.response?.data?.detail || 'Failed to give boost', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleBroadcast = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      const token = localStorage.getItem('profitpilot_token');
      const response = await axios.post(`${BACKEND_URL}/api/admin/broadcast`, broadcastForm, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showNotification(response.data.message, 'success');
      setBroadcastForm({ title: '', message: '', type: 'info', priority: 'medium' });
      fetchAdminBroadcasts();
    } catch (error) {
      showNotification(error.response?.data?.detail || 'Failed to send broadcast', 'error');
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

  useEffect(() => {
    if (activeTab === 'board' && !leaderboardData) {
      fetchLeaderboard();
    }
    if (activeTab === 'admin' && currentUser?.is_admin) {
      if (adminSubTab === 'overview' && !adminStats) {
        fetchAdminStats();
      } else if (adminSubTab === 'users' && adminUsers.length === 0) {
        fetchAdminUsers();
      } else if (adminSubTab === 'tasks' && adminTasks.length === 0) {
        fetchAdminTasks();
      } else if (adminSubTab === 'broadcasts' && adminBroadcasts.length === 0) {
        fetchAdminBroadcasts();
      }
    }
  }, [activeTab, adminSubTab]);

  const formatCurrency = (amount) => {
    if (amount === Infinity) return '∞ USD';
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
            { id: 'tasks', icon: '🎯', label: 'Tasks', desc: 'Complete & earn' },
            { id: 'notifications', icon: '🔔', label: 'Notifications', desc: `${unreadCount} unread` },
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
          {currentUser?.is_admin && (
            <button
              onClick={() => {
                setActiveTab('admin');
                setShowMobileMenu(false);
              }}
              className={`w-full text-left p-3 rounded-lg transition-colors ${
                activeTab === 'admin' ? 'bg-blue-50 text-blue-600' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center space-x-3">
                <span className="text-xl">⚙️</span>
                <div>
                  <div className="font-medium">Admin Panel</div>
                  <div className="text-sm text-gray-500">System management</div>
                </div>
              </div>
            </button>
          )}
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
                {currentUser?.is_admin && (
                  <span className="ml-2 text-xs bg-purple-100 text-purple-600 px-2 py-1 rounded-full font-medium">ADMIN</span>
                )}
                
                <div className="ml-2 flex items-center space-x-1">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-xs text-gray-500 hidden sm:block">Auto-refresh</span>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2 sm:space-x-4">
              {!currentUser?.is_admin && miningCountdown && (
                <div className="hidden sm:flex items-center space-x-2 bg-orange-50 rounded-lg px-3 py-1">
                  <span className="text-sm text-orange-600">Next:</span>
                  <span className="text-sm font-bold text-orange-600">{miningCountdown}</span>
                </div>
              )}

              {!currentUser?.is_admin && unreadCount > 0 && (
                <button
                  onClick={() => setActiveTab('notifications')}
                  className="relative bg-blue-50 hover:bg-blue-100 text-blue-600 text-sm px-3 py-2 rounded-lg font-medium transition-colors"
                >
                  🔔
                  <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                    {unreadCount}
                  </span>
                </button>
              )}

              <div className="hidden md:flex items-center space-x-2 bg-gray-50 rounded-lg px-3 py-1">
                <span className="text-sm text-gray-600">Balance:</span>
                <span className="text-sm font-bold text-green-600">{formatCurrency(currentUser?.total_earnings || 0)}</span>
              </div>
              
              {!currentUser?.is_admin && (
                <div className="hidden sm:flex items-center space-x-2 bg-blue-50 rounded-lg px-3 py-1">
                  <span className="text-sm text-gray-600">Tokens:</span>
                  <span className="text-sm font-bold text-blue-600">{currentUser?.tokens_owned || 0}/5</span>
                </div>
              )}

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
              ...(currentUser?.is_admin ? [] : [
                { id: 'tokens', icon: '🪙', label: 'My Tokens' },
                { id: 'boost', icon: '⚡', label: 'Boost Center' },
                { id: 'tasks', icon: '🎯', label: 'Tasks' },
                { id: 'notifications', icon: '🔔', label: `Notifications${unreadCount > 0 ? ` (${unreadCount})` : ''}` }
              ]),
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
                ⚙️ Admin Panel
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
            ...(currentUser?.is_admin ? [
              { id: 'admin', icon: '⚙️', label: 'Admin' }
            ] : [
              { id: 'tokens', icon: '🪙', label: 'Tokens' },
              { id: 'tasks', icon: '🎯', label: 'Tasks' }
            ]),
            { id: 'notifications', icon: unreadCount > 0 ? '🔴' : '🔔', label: 'Alerts' },
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
                  <h1 className="text-2xl sm:text-3xl font-bold mb-2">
                    Welcome Back{currentUser?.is_admin ? ', Admin' : ''}! 👋
                  </h1>
                  <p className="text-blue-100 mb-6">
                    {currentUser?.is_admin ? 'System overview and controls' : 'Here\'s your portfolio performance'}
                  </p>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 lg:gap-8">
                    <div>
                      <p className="text-blue-200 text-sm mb-1">
                        {currentUser?.is_admin ? 'Admin Balance' : 'Total Balance'}
                      </p>
                      <p className="text-2xl sm:text-4xl font-bold">
                        {formatCurrency(dashboardData.stats.total_balance)}
                      </p>
                    </div>
                    <div>
                      <p className="text-blue-200 text-sm mb-1">
                        {currentUser?.is_admin ? 'System Status' : 'Active Assets'}
                      </p>
                      <p className="text-2xl sm:text-4xl font-bold">
                        {currentUser?.is_admin ? 'ONLINE' : dashboardData.stats.active_assets}
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="mt-4 lg:mt-0 text-right">
                  <div className="bg-white bg-opacity-20 rounded-lg p-3">
                    <span className="text-2xl">{currentUser?.is_admin ? '⚙️' : '✨'}</span>
                  </div>
                </div>
              </div>

              {!currentUser?.is_admin && miningCountdown && (
                <div className="mt-6 sm:hidden bg-white bg-opacity-20 rounded-lg p-3 text-center">
                  <p className="text-blue-100 text-sm">Next Mining</p>
                  <p className="text-lg font-bold">{miningCountdown}</p>
                </div>
              )}

              <div className="mt-4 flex items-center justify-center sm:justify-start space-x-2 text-blue-100 text-sm">
                <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                <span>Updates automatically every minute</span>
              </div>
            </div>

            {currentUser?.is_admin && (
              <div className="bg-purple-50 rounded-xl p-4 lg:p-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">🔧 Quick Admin Actions</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <button
                    onClick={triggerMining}
                    disabled={loading}
                    className="flex items-center justify-center space-x-2 bg-purple-600 text-white px-4 py-3 rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors"
                  >
                    <span>⛏️</span>
                    <span>{loading ? 'Mining...' : 'Mine Now'}</span>
                  </button>
                  <button
                    onClick={() => {setActiveTab('admin'); setAdminSubTab('users');}}
                    className="flex items-center justify-center space-x-2 bg-blue-600 text-white px-4 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                  >
                    <span>👥</span>
                    <span>Manage Users</span>
                  </button>
                  <button
                    onClick={() => {setActiveTab('admin'); setAdminSubTab('broadcasts');}}
                    className="flex items-center justify-center space-x-2 bg-green-600 text-white px-4 py-3 rounded-lg font-medium hover:bg-green-700 transition-colors"
                  >
                    <span>📢</span>
                    <span>Broadcast</span>
                  </button>
                  <button
                    onClick={() => fetchDashboard()}
                    className="flex items-center justify-center space-x-2 bg-orange-600 text-white px-4 py-3 rounded-lg font-medium hover:bg-orange-700 transition-colors"
                  >
                    <span>🔄</span>
                    <span>Refresh</span>
                  </button>
                </div>
              </div>
            )}

            {!currentUser?.is_admin && (
              <>
                <div className="grid grid-cols-2 gap-4 sm:hidden">
                  <button
                    onClick={() => setActiveTab('tokens')}
                    className="bg-white rounded-xl p-4 text-center shadow-sm border"
                  >
                    <div className="text-2xl mb-2">🪙</div>
                    <div className="text-sm font-medium text-gray-800">My Tokens</div>
                  </button>
                  <button
                    onClick={() => setActiveTab('tasks')}
                    className="bg-white rounded-xl p-4 text-center shadow-sm border relative"
                  >
                    <div className="text-2xl mb-2">🎯</div>
                    <div className="text-sm font-medium text-gray-800">Tasks</div>
                    {userTasks.length > 0 && (
                      <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                        {userTasks.length}
                      </span>
                    )}
                  </button>
                </div>

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
              </>
            )}
          </div>
        )}

        {/* Tasks Tab */}
        {activeTab === 'tasks' && !currentUser?.is_admin && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
              <h2 className="text-2xl font-bold text-gray-800 mb-2 sm:mb-0">🎯 Available Tasks</h2>
              <p className="text-gray-600">Complete tasks to earn extra rewards</p>
            </div>

            {userTasks.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm p-8 text-center">
                <div className="text-4xl mb-4">🎯</div>
                <h3 className="text-lg font-semibold text-gray-800 mb-2">No Tasks Available</h3>
                <p className="text-gray-600">Check back later for new earning opportunities!</p>
              </div>
            ) : (
              <div className="grid gap-6">
                {userTasks.map((task) => (
                  <div key={task.task_id} className="bg-white rounded-xl shadow-sm p-6">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start mb-4">
                      <div className="mb-4 sm:mb-0">
                        <h3 className="text-lg font-semibold text-gray-800 mb-2">{task.title}</h3>
                        <p className="text-gray-600 mb-2">{task.description}</p>
                        {task.requirements && (
                          <p className="text-sm text-blue-600">Requirements: {task.requirements}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium mb-2">
                          +{formatCurrency(task.reward)}
                        </div>
                        <div className="text-xs text-gray-500">
                          {task.type === 'daily' ? 'Daily Task' : 
                           task.type === 'repeatable' ? 'Repeatable' : 'One Time'}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
                      <div className="text-sm text-gray-500 mb-2 sm:mb-0">
                        {task.expires_at && `Expires: ${new Date(task.expires_at).toLocaleDateString()}`}
                      </div>
                      <button
                        onClick={() => completeTask(task.task_id)}
                        className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                      >
                        Complete Task
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Notifications Tab */}
        {activeTab === 'notifications' && !currentUser?.is_admin && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
              <h2 className="text-2xl font-bold text-gray-800 mb-2 sm:mb-0">🔔 Notifications</h2>
              <p className="text-gray-600">{unreadCount} unread messages</p>
            </div>

            {userNotifications.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm p-8 text-center">
                <div className="text-4xl mb-4">🔔</div>
                <h3 className="text-lg font-semibold text-gray-800 mb-2">No Notifications</h3>
                <p className="text-gray-600">You're all caught up!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {userNotifications.map((notification) => (
                  <div 
                    key={notification.notification_id} 
                    className={`bg-white rounded-xl shadow-sm p-4 cursor-pointer transition-colors ${
                      !notification.read ? 'border-l-4 border-blue-500 bg-blue-50' : ''
                    }`}
                    onClick={() => !notification.read && markNotificationRead(notification.notification_id)}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-800 mb-1">{notification.title}</h3>
                        <p className="text-gray-600 text-sm mb-2">{notification.message}</p>
                        <p className="text-xs text-gray-500">
                          {new Date(notification.created_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="ml-4">
                        <span className={`inline-block w-3 h-3 rounded-full ${
                          notification.type === 'success' ? 'bg-green-500' :
                          notification.type === 'error' ? 'bg-red-500' :
                          notification.type === 'warning' ? 'bg-yellow-500' : 'bg-blue-500'
                        }`}></span>
                        {!notification.read && (
                          <div className="w-2 h-2 bg-blue-500 rounded-full mt-1 ml-0.5"></div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Admin Panel */}
        {activeTab === 'admin' && currentUser?.is_admin && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
              <h2 className="text-2xl font-bold text-gray-800 mb-2 sm:mb-0">⚙️ Admin Panel</h2>
              <p className="text-gray-600">System management and user controls</p>
            </div>

            {/* Admin Sub-Navigation */}
            <div className="bg-white rounded-xl shadow-sm">
              <div className="flex flex-wrap border-b">
                {[
                  { id: 'overview', label: 'Overview', icon: '📊' },
                  { id: 'users', label: 'User Management', icon: '👥' },
                  { id: 'tasks', label: 'Task Manager', icon: '🎯' },
                  { id: 'broadcasts', label: 'Broadcasts', icon: '📢' },
                  { id: 'actions', label: 'Quick Actions', icon: '⚡' }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setAdminSubTab(tab.id)}
                    className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                      adminSubTab === tab.id
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {tab.icon} {tab.label}
                  </button>
                ))}
              </div>

              <div className="p-6">
                {adminSubTab === 'overview' && (
                  <div className="space-y-6">
                    {adminStats && (
                      <>
                        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                          <div className="bg-blue-50 rounded-lg p-4 text-center">
                            <div className="text-2xl font-bold text-blue-600">{adminStats.total_users}</div>
                            <div className="text-sm text-gray-600">Total Users</div>
                          </div>
                          <div className="bg-green-50 rounded-lg p-4 text-center">
                            <div className="text-2xl font-bold text-green-600">{adminStats.total_tokens}</div>
                            <div className="text-sm text-gray-600">Total Tokens</div>
                          </div>
                          <div className="bg-purple-50 rounded-lg p-4 text-center">
                            <div className="text-2xl font-bold text-purple-600">{adminStats.total_transactions}</div>
                            <div className="text-sm text-gray-600">Transactions</div>
                          </div>
                          <div className="bg-orange-50 rounded-lg p-4 text-center">
                            <div className="text-2xl font-bold text-orange-600">{adminStats.total_tasks}</div>
                            <div className="text-sm text-gray-600">Tasks Created</div>
                          </div>
                          <div className="bg-pink-50 rounded-lg p-4 text-center">
                            <div className="text-2xl font-bold text-pink-600">{adminStats.total_broadcasts}</div>
                            <div className="text-sm text-gray-600">Broadcasts</div>
                          </div>
                        </div>

                        <div className="bg-gray-50 rounded-lg p-4">
                          <h3 className="font-semibold text-gray-800 mb-2">Platform Earnings</h3>
                          <div className="text-3xl font-bold text-green-600">
                            {formatCurrency(adminStats.total_platform_earnings)}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {adminSubTab === 'users' && (
                  <div className="space-y-6">
                    <div className="flex justify-between items-center">
                      <h3 className="text-lg font-semibold text-gray-800">User Management</h3>
                      <button
                        onClick={fetchAdminUsers}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        Refresh Users
                      </button>
                    </div>

                    <div className="grid gap-4">
                      {adminUsers.map((user) => (
                        <div key={user.user_id} className="bg-gray-50 rounded-lg p-4">
                          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                            <div className="mb-4 sm:mb-0">
                              <h4 className="font-semibold text-gray-800">{user.user_id}</h4>
                              <p className="text-sm text-gray-600">{user.email}</p>
                              <p className="text-sm text-gray-500">
                                Joined: {new Date(user.created_at).toLocaleDateString()}
                              </p>
                              <div className="flex space-x-4 mt-2 text-sm">
                                <span>Balance: {formatCurrency(user.total_earnings)}</span>
                                <span>Tokens: {user.tokens_owned}</span>
                                <span>Referrals: {user.referrals_count}</span>
                              </div>
                            </div>
                            <button
                              onClick={() => fetchUserDetails(user.user_id)}
                              className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 transition-colors"
                            >
                              View Details
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {selectedUser && (
                      <div className="bg-white border-2 border-blue-200 rounded-lg p-6">
                        <h3 className="text-lg font-semibold text-gray-800 mb-4">
                          User Details: {selectedUser.user.user_id}
                        </h3>
                        
                        <div className="grid lg:grid-cols-2 gap-6">
                          <div>
                            <h4 className="font-medium text-gray-800 mb-2">Basic Info</h4>
                            <div className="space-y-2 text-sm">
                              <p><strong>Email:</strong> {selectedUser.user.email}</p>
                              <p><strong>Balance:</strong> {formatCurrency(selectedUser.user.total_earnings)}</p>
                              <p><strong>Tokens:</strong> {selectedUser.user.tokens_owned}</p>
                              <p><strong>Referrals:</strong> {selectedUser.user.referrals_count}</p>
                            </div>
                          </div>
                          
                          <div>
                            <h4 className="font-medium text-gray-800 mb-2">User Tokens</h4>
                            <div className="space-y-2">
                              {selectedUser.tokens.map((token) => (
                                <div key={token.token_id} className="text-sm bg-gray-100 p-2 rounded">
                                  <p><strong>{token.name}</strong> - Level {token.boost_level}</p>
                                  <p>Earned: {formatCurrency(token.total_earnings)}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={() => setSelectedUser(null)}
                          className="mt-4 bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 transition-colors"
                        >
                          Close Details
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {adminSubTab === 'tasks' && (
                  <div className="space-y-6">
                    <div className="flex justify-between items-center">
                      <h3 className="text-lg font-semibold text-gray-800">Task Manager</h3>
                      <button
                        onClick={fetchAdminTasks}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        Refresh Tasks
                      </button>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-6">
                      <h4 className="font-medium text-gray-800 mb-4">Create New Task</h4>
                      <form onSubmit={handleCreateTask} className="space-y-4">
                        <div className="grid lg:grid-cols-2 gap-4">
                          <input
                            type="text"
                            placeholder="Task Title"
                            value={createTaskForm.title}
                            onChange={(e) => setCreateTaskForm({...createTaskForm, title: e.target.value})}
                            className="w-full p-3 border border-gray-300 rounded-lg"
                            required
                          />
                          <input
                            type="number"
                            step="0.01"
                            placeholder="Reward Amount ($)"
                            value={createTaskForm.reward}
                            onChange={(e) => setCreateTaskForm({...createTaskForm, reward: e.target.value})}
                            className="w-full p-3 border border-gray-300 rounded-lg"
                            required
                          />
                        </div>
                        <textarea
                          placeholder="Task Description"
                          value={createTaskForm.description}
                          onChange={(e) => setCreateTaskForm({...createTaskForm, description: e.target.value})}
                          className="w-full p-3 border border-gray-300 rounded-lg h-24"
                          required
                        />
                        <div className="grid lg:grid-cols-3 gap-4">
                          <select
                            value={createTaskForm.type}
                            onChange={(e) => setCreateTaskForm({...createTaskForm, type: e.target.value})}
                            className="w-full p-3 border border-gray-300 rounded-lg"
                          >
                            <option value="one_time">One Time</option>
                            <option value="daily">Daily</option>
                            <option value="repeatable">Repeatable</option>
                          </select>
                          <input
                            type="text"
                            placeholder="Requirements (optional)"
                            value={createTaskForm.requirements}
                            onChange={(e) => setCreateTaskForm({...createTaskForm, requirements: e.target.value})}
                            className="w-full p-3 border border-gray-300 rounded-lg"
                          />
                          <input
                            type="datetime-local"
                            placeholder="Expires At (optional)"
                            value={createTaskForm.expires_at}
                            onChange={(e) => setCreateTaskForm({...createTaskForm, expires_at: e.target.value})}
                            className="w-full p-3 border border-gray-300 rounded-lg"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={loading}
                          className="bg-green-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                          {loading ? 'Creating...' : 'Create Task'}
                        </button>
                      </form>
                    </div>

                    <div className="grid gap-4">
                      {adminTasks.map((task) => (
                        <div key={task.task_id} className="bg-gray-50 rounded-lg p-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <h4 className="font-semibold text-gray-800">{task.title}</h4>
                              <p className="text-gray-600 text-sm">{task.description}</p>
                              <div className="flex space-x-4 mt-2 text-sm text-gray-500">
                                <span>Reward: {formatCurrency(task.reward)}</span>
                                <span>Type: {task.type}</span>
                                <span>Completed: {task.completion_count} times</span>
                              </div>
                            </div>
                            <span className={`px-2 py-1 rounded text-xs ${
                              task.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                            }`}>
                              {task.active ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {adminSubTab === 'broadcasts' && (
                  <div className="space-y-6">
                    <div className="flex justify-between items-center">
                      <h3 className="text-lg font-semibold text-gray-800">Broadcast Center</h3>
                      <button
                        onClick={fetchAdminBroadcasts}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        Refresh Broadcasts
                      </button>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-6">
                      <h4 className="font-medium text-gray-800 mb-4">Send Broadcast Message</h4>
                      <form onSubmit={handleBroadcast} className="space-y-4">
                        <div className="grid lg:grid-cols-2 gap-4">
                          <input
                            type="text"
                            placeholder="Broadcast Title"
                            value={broadcastForm.title}
                            onChange={(e) => setBroadcastForm({...broadcastForm, title: e.target.value})}
                            className="w-full p-3 border border-gray-300 rounded-lg"
                            required
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              value={broadcastForm.type}
                              onChange={(e) => setBroadcastForm({...broadcastForm, type: e.target.value})}
                              className="w-full p-3 border border-gray-300 rounded-lg"
                            >
                              <option value="info">Info</option>
                              <option value="success">Success</option>
                              <option value="warning">Warning</option>
                              <option value="error">Error</option>
                            </select>
                            <select
                              value={broadcastForm.priority}
                              onChange={(e) => setBroadcastForm({...broadcastForm, priority: e.target.value})}
                              className="w-full p-3 border border-gray-300 rounded-lg"
                            >
                              <option value="low">Low</option>
                              <option value="medium">Medium</option>
                              <option value="high">High</option>
                            </select>
                          </div>
                        </div>
                        <textarea
                          placeholder="Broadcast Message"
                          value={broadcastForm.message}
                          onChange={(e) => setBroadcastForm({...broadcastForm, message: e.target.value})}
                          className="w-full p-3 border border-gray-300 rounded-lg h-24"
                          required
                        />
                        <button
                          type="submit"
                          disabled={loading}
                          className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                        >
                          {loading ? 'Sending...' : 'Send Broadcast'}
                        </button>
                      </form>
                    </div>

                    <div className="grid gap-4">
                      {adminBroadcasts.map((broadcast) => (
                        <div key={broadcast.broadcast_id} className="bg-gray-50 rounded-lg p-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <h4 className="font-semibold text-gray-800">{broadcast.title}</h4>
                              <p className="text-gray-600 text-sm">{broadcast.message}</p>
                              <div className="flex space-x-4 mt-2 text-sm text-gray-500">
                                <span>Recipients: {broadcast.recipient_count}</span>
                                <span>Type: {broadcast.type}</span>
                                <span>Priority: {broadcast.priority}</span>
                                <span>Sent: {new Date(broadcast.created_at).toLocaleString()}</span>
                              </div>
                            </div>
                            <span className={`px-2 py-1 rounded text-xs ${
                              broadcast.type === 'success' ? 'bg-green-100 text-green-800' :
                              broadcast.type === 'error' ? 'bg-red-100 text-red-800' :
                              broadcast.type === 'warning' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-blue-100 text-blue-800'
                            }`}>
                              {broadcast.type}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {adminSubTab === 'actions' && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold text-gray-800">Quick Actions</h3>
                    
                    <div className="grid lg:grid-cols-2 gap-6">
                      <div className="bg-gray-50 rounded-lg p-6">
                        <h4 className="font-medium text-gray-800 mb-4">Send Balance to User</h4>
                        <form onSubmit={handleSendBalance} className="space-y-4">
                          <input
                            type="text"
                            placeholder="User ID"
                            value={sendBalanceForm.user_id}
                            onChange={(e) => setSendBalanceForm({...sendBalanceForm, user_id: e.target.value})}
                            className="w-full p-3 border border-gray-300 rounded-lg"
                            required
                          />
                          <input
                            type="number"
                            step="0.01"
                            placeholder="Amount ($)"
                            value={sendBalanceForm.amount}
                            onChange={(e) => setSendBalanceForm({...sendBalanceForm, amount: e.target.value})}
                            className="w-full p-3 border border-gray-300 rounded-lg"
                            required
                          />
                          <input
                            type="text"
                            placeholder="Reason"
                            value={sendBalanceForm.reason}
                            onChange={(e) => setSendBalanceForm({...sendBalanceForm, reason: e.target.value})}
                            className="w-full p-3 border border-gray-300 rounded-lg"
                            required
                          />
                          <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-green-600 text-white py-3 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                          >
                            {loading ? 'Sending...' : 'Send Balance'}
                          </button>
                        </form>
                      </div>

                      <div className="bg-gray-50 rounded-lg p-6">
                        <h4 className="font-medium text-gray-800 mb-4">Give Token Boost</h4>
                        <form onSubmit={handleGiveBoost} className="space-y-4">
                          <input
                            type="text"
                            placeholder="User ID"
                            value={giveBoostForm.user_id}
                            onChange={(e) => setGiveBoostForm({...giveBoostForm, user_id: e.target.value})}
                            className="w-full p-3 border border-gray-300 rounded-lg"
                            required
                          />
                          <input
                            type="text"
                            placeholder="Token ID"
                            value={giveBoostForm.token_id}
                            onChange={(e) => setGiveBoostForm({...giveBoostForm, token_id: e.target.value})}
                            className="w-full p-3 border border-gray-300 rounded-lg"
                            required
                          />
                          <input
                            type="number"
                            min="1"
                            placeholder="Boost Levels"
                            value={giveBoostForm.boost_levels}
                            onChange={(e) => setGiveBoostForm({...giveBoostForm, boost_levels: e.target.value})}
                            className="w-full p-3 border border-gray-300 rounded-lg"
                            required
                          />
                          <input
                            type="text"
                            placeholder="Reason"
                            value={giveBoostForm.reason}
                            onChange={(e) => setGiveBoostForm({...giveBoostForm, reason: e.target.value})}
                            className="w-full p-3 border border-gray-300 rounded-lg"
                            required
                          />
                          <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-purple-600 text-white py-3 rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors"
                          >
                            {loading ? 'Applying...' : 'Give Boost'}
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Existing tabs (tokens, boost, etc.) remain the same as original */}
        {(activeTab === 'tokens' || activeTab === 'boost') && dashboardData && !currentUser?.is_admin && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
              <h2 className="text-2xl font-bold text-gray-800 mb-2 sm:mb-0">
                {activeTab === 'tokens' ? '🪙 Your Tokens' : '⚡ Boost Center'}
              </h2>
              <p className="text-gray-600">
                {activeTab === 'tokens' ? 'Manage your mining tokens' : 'Upgrade tokens for higher earnings'}
              </p>
            </div>

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

        {/* Referrals Tab */}
        {activeTab === 'referrals' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
              <h2 className="text-2xl font-bold text-gray-800 mb-2 sm:mb-0">🤝 Referral Program</h2>
              <p className="text-gray-600">Earn $2 for every friend you invite</p>
            </div>

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
              </div>
            </div>
          </div>
        )}

        {/* Profile Tab */}
        {activeTab === 'profile' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
              <h2 className="text-2xl font-bold text-gray-800 mb-2 sm:mb-0">👤 Profile</h2>
              <p className="text-gray-600">Manage your account and settings</p>
            </div>

            <div className="bg-white rounded-xl shadow-sm">
              <div className="flex flex-wrap border-b">
                {[
                  { id: 'account', label: 'Account', icon: '👤' },
                  { id: 'security', label: 'Security', icon: '🔐' },
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

                    {currentUser?.is_admin && (
                      <div className="bg-purple-50 rounded-lg p-4">
                        <h4 className="font-medium text-purple-800 mb-2">🔧 Admin Privileges</h4>
                        <div className="text-sm text-purple-700 space-y-1">
                          <p>✓ Unlimited balance</p>
                          <p>✓ User management access</p>
                          <p>✓ System controls</p>
                          <p>✓ Broadcasting capabilities</p>
                          <p>✓ Hidden from leaderboards</p>
                        </div>
                      </div>
                    )}

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
                    
                    <div className="bg-yellow-50 rounded-lg p-4">
                      <h4 className="font-medium text-gray-800 mb-2">🔐 Account Security</h4>
                      <p className="text-sm text-gray-600">
                        Your account is secured with industry-standard encryption. 
                        Password change functionality coming soon!
                      </p>
                    </div>
                  </div>
                )}

                {profileSubTab === 'settings' && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold text-gray-800">App Settings</h3>
                    
                    <div className="space-y-4">
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
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Leaderboard Tab */}
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

        {/* Help Tab */}
        {activeTab === 'help' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
              <h2 className="text-2xl font-bold text-gray-800 mb-2 sm:mb-0">❓ Help Center</h2>
              <p className="text-gray-600">Everything you need to know about ProfitPilot</p>
            </div>

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
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm p-4 lg:p-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">🎯 Tasks & Notifications</h3>
                <div className="space-y-4">
                  <div className="border-l-4 border-purple-500 pl-4">
                    <h4 className="font-medium text-gray-800">What are tasks?</h4>
                    <p className="text-sm text-gray-600">Complete simple tasks created by admin to earn extra rewards. Check the Tasks tab regularly for new opportunities!</p>
                  </div>
                  <div className="border-l-4 border-orange-500 pl-4">
                    <h4 className="font-medium text-gray-800">How do notifications work?</h4>
                    <p className="text-sm text-gray-600">Get notified about mining completions, task rewards, admin announcements, and more. Check the bell icon for updates!</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
