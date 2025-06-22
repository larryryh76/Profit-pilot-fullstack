import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

// Get backend URL from environment
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState('home');
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // 'login' or 'register'
  const [leaderboardData, setLeaderboardData] = useState(null);
  const [adminStats, setAdminStats] = useState(null);

  // Auth form state
  const [authForm, setAuthForm] = useState({
    email: '',
    password: '',
    referralCode: ''
  });

  // Check for existing token on app load
  useEffect(() => {
    const token = localStorage.getItem('profitpilot_token');
    if (token) {
      fetchDashboard(token);
    } else {
      setShowAuth(true);
    }
  }, []);

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
    } catch (error) {
      console.error('Dashboard fetch error:', error);
      if (error.response?.status === 401) {
        localStorage.removeItem('profitpilot_token');
        setShowAuth(true);
      } else {
        alert('Failed to load dashboard data');
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
    } catch (error) {
      alert(error.response?.data?.detail || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('profitpilot_token');
    setCurrentUser(null);
    setDashboardData(null);
    setShowAuth(true);
    setActiveTab('home');
  };

  const handlePayment = async (action, tokenId = null) => {
    try {
      setLoading(true);
      const token = localStorage.getItem('profitpilot_token');
      
      // Initialize payment
      const response = await axios.post(
        `${BACKEND_URL}/api/payment/initialize`,
        { action, token_id: tokenId },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      // Redirect to Paystack
      if (response.data.authorization_url) {
        window.location.href = response.data.authorization_url;
      } else {
        alert('Payment initialization failed - no authorization URL received');
      }
    } catch (error) {
      console.error('Payment error:', error);
      alert(error.response?.data?.detail || 'Payment initialization failed');
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
    alert('Referral link copied to clipboard!');
  };

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
          </div>

          <div className="flex mb-6">
            <button
              className={`flex-1 py-2 px-4 rounded-l-lg font-medium ${authMode === 'login' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
              onClick={() => setAuthMode('login')}
            >
              Login
            </button>
            <button
              className={`flex-1 py-2 px-4 rounded-r-lg font-medium ${authMode === 'register' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
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
                className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <input
                type="password"
                placeholder="Password"
                value={authForm.password}
                onChange={(e) => setAuthForm({...authForm, password: e.target.value})}
                className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-3 rounded-lg font-medium hover:opacity-90 disabled:opacity-50"
            >
              {loading ? 'Processing...' : (authMode === 'login' ? 'Login' : 'Register')}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <div className="bg-gradient-to-r from-blue-600 to-purple-600 w-10 h-10 rounded-full flex items-center justify-center">
                <span className="text-white text-lg font-bold">P</span>
              </div>
              <span className="ml-3 text-xl font-bold text-gray-800">ProfitPilot</span>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">{currentUser?.email}</span>
              <button
                onClick={handleLogout}
                className="text-sm text-red-600 hover:text-red-700"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8">
            <button
              className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'home' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              onClick={() => setActiveTab('home')}
            >
              📊 Home
            </button>
            <button
              className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'tokens' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              onClick={() => setActiveTab('tokens')}
            >
              🪙 Tokens
            </button>
            <button
              className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'board' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              onClick={() => setActiveTab('board')}
            >
              🏆 Board
            </button>
            {currentUser?.is_admin && (
              <button
                className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'admin' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                onClick={() => setActiveTab('admin')}
              >
                ⚙️ Admin
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'home' && dashboardData && (
          <div className="space-y-6">
            {/* Welcome Header */}
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl text-white p-8">
              <div className="flex justify-between items-start">
                <div>
                  <h1 className="text-3xl font-bold mb-2">Good {new Date().getHours() < 18 ? 'Morning' : 'Evening'}</h1>
                  <p className="text-blue-100 mb-6">Here's your portfolio performance today</p>
                  
                  <div className="grid grid-cols-2 gap-8">
                    <div>
                      <p className="text-blue-200 text-sm mb-1">Total Balance</p>
                      <p className="text-4xl font-bold">{formatCurrency(dashboardData.stats.total_balance)}</p>
                    </div>
                    <div>
                      <p className="text-blue-200 text-sm mb-1">Active Assets</p>
                      <p className="text-4xl font-bold">{dashboardData.stats.active_assets}</p>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="bg-white bg-opacity-20 rounded-lg p-3">
                    <span className="text-2xl">✨</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-green-50 rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="bg-green-500 rounded-lg p-2">
                    <span className="text-white text-lg">💰</span>
                  </div>
                  <span className="text-green-600 text-sm font-medium">+2.5% from last period</span>
                </div>
                <p className="text-gray-600 text-sm mb-1">Total Earnings</p>
                <p className="text-2xl font-bold text-gray-800">{formatCurrency(currentUser.total_earnings)}</p>
              </div>

              <div className="bg-blue-50 rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="bg-blue-500 rounded-lg p-2">
                    <span className="text-white text-lg">🔗</span>
                  </div>
                  <span className="text-blue-600 text-sm font-medium">{currentUser.tokens_owned}/5</span>
                </div>
                <p className="text-gray-600 text-sm mb-1">Active Tokens</p>
                <p className="text-2xl font-bold text-gray-800">{currentUser.tokens_owned}</p>
              </div>

              <div className="bg-purple-50 rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="bg-purple-500 rounded-lg p-2">
                    <span className="text-white text-lg">👥</span>
                  </div>
                  <span className="text-purple-600 text-sm font-medium">{formatCurrency(currentUser.referral_earnings)} earned</span>
                </div>
                <p className="text-gray-600 text-sm mb-1">Referrals</p>
                <p className="text-2xl font-bold text-gray-800">{currentUser.referrals_count}</p>
              </div>

              <div className="bg-orange-50 rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="bg-orange-500 rounded-lg p-2">
                    <span className="text-white text-lg">⚡</span>
                  </div>
                  <span className="text-orange-600 text-sm font-medium">Total Boosts</span>
                </div>
                <p className="text-gray-600 text-sm mb-1">Total Boosts</p>
                <p className="text-2xl font-bold text-gray-800">{currentUser.boosts_used}</p>
              </div>
            </div>

            {/* Referral Section */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">🤝 Referral Program</h3>
              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <p className="text-sm text-gray-600 mb-2">Your referral code:</p>
                <div className="flex items-center space-x-2">
                  <code className="bg-gray-200 px-3 py-1 rounded text-sm font-mono">{currentUser.referral_code}</code>
                  <button
                    onClick={copyReferralLink}
                    className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
                  >
                    Copy Link
                  </button>
                </div>
              </div>
              <p className="text-sm text-gray-600">Earn $2 for each person who joins with your code!</p>
            </div>

            {/* Withdrawal Timer */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">💸 Withdrawal Status</h3>
              <div className="bg-yellow-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-800">Time until withdrawal eligible:</p>
                    <p className="text-2xl font-bold text-yellow-600">{formatTimeUntilWithdrawal(currentUser.withdrawal_eligible_at)}</p>
                  </div>
                  <div className="text-yellow-500 text-3xl">⏰</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'tokens' && dashboardData && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-800">🪙 Your Tokens</h2>
              <p className="text-gray-600">Manage your mining tokens and earnings</p>
            </div>

            {currentUser.tokens_owned < 5 && (
              <div className="bg-blue-50 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-2">Add More Tokens</h3>
                <p className="text-gray-600 mb-4">Expand your mining capacity with additional tokens ($5 each)</p>
                <button
                  onClick={() => handlePayment('token')}
                  disabled={loading}
                  className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  + Add Token ($5)
                </button>
              </div>
            )}

            <div className="grid gap-6">
              {dashboardData.tokens.map((token, index) => (
                <div key={token.token_id} className="bg-white rounded-xl shadow-sm p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-800">{token.name}</h3>
                      <p className="text-sm text-gray-500">Created: {new Date(token.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-500">Boost Level</p>
                      <p className="text-2xl font-bold text-blue-600">{token.boost_level}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div>
                      <p className="text-sm text-gray-500">Total Earned</p>
                      <p className="text-lg font-semibold text-green-600">{formatCurrency(token.total_earnings)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Hourly Rate</p>
                      <p className="text-lg font-semibold text-blue-600">{formatCurrency(token.hourly_rate)}/hr</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Next Boost Cost</p>
                      <p className="text-lg font-semibold text-orange-600">{formatCurrency(3 * Math.pow(2, token.boost_level))}</p>
                    </div>
                  </div>

                  <button
                    onClick={() => handlePayment('boost', token.token_id)}
                    disabled={loading}
                    className="w-full bg-gradient-to-r from-orange-500 to-red-500 text-white py-2 rounded-lg font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    ⚡ Boost Token ({formatCurrency(3 * Math.pow(2, token.boost_level))})
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'board' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-800">🏆 Leaderboard</h2>
            
            {leaderboardData ? (
              <div className="grid md:grid-cols-2 gap-6">
                <div className="bg-white rounded-xl shadow-sm p-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">Top Earners</h3>
                  <div className="space-y-3">
                    {leaderboardData.top_earners.map((user, index) => (
                      <div key={user.user_id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center space-x-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold ${index === 0 ? 'bg-yellow-500' : index === 1 ? 'bg-gray-400' : index === 2 ? 'bg-orange-600' : 'bg-gray-300'}`}>
                            {index + 1}
                          </div>
                          <div>
                            <p className="font-medium">{user.user_id}</p>
                            <p className="text-sm text-gray-500">{user.email}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-green-600">{formatCurrency(user.total_earnings)}</p>
                          <p className="text-xs text-gray-500">{user.tokens_owned} tokens</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm p-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">Most Boosted Tokens</h3>
                  <div className="space-y-3">
                    {leaderboardData.top_tokens.map((token, index) => (
                      <div key={token.name} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center space-x-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold ${index === 0 ? 'bg-yellow-500' : index === 1 ? 'bg-gray-400' : index === 2 ? 'bg-orange-600' : 'bg-gray-300'}`}>
                            {index + 1}
                          </div>
                          <div>
                            <p className="font-medium">{token.name}</p>
                            <p className="text-sm text-gray-500">Owner: {token.owner_id}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-blue-600">Level {token.boost_level}</p>
                          <p className="text-xs text-gray-500">{formatCurrency(token.total_earnings)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-gray-500">Loading leaderboard...</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'admin' && currentUser?.is_admin && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-800">⚙️ Admin Panel</h2>
            
            {adminStats ? (
              <div className="grid md:grid-cols-4 gap-6">
                <div className="bg-white rounded-xl shadow-sm p-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">Total Users</h3>
                  <p className="text-3xl font-bold text-blue-600">{adminStats.total_users}</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm p-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">Total Tokens</h3>
                  <p className="text-3xl font-bold text-green-600">{adminStats.total_tokens}</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm p-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">Transactions</h3>
                  <p className="text-3xl font-bold text-orange-600">{adminStats.total_transactions}</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm p-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">Platform Earnings</h3>
                  <p className="text-3xl font-bold text-purple-600">{formatCurrency(adminStats.total_platform_earnings)}</p>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
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