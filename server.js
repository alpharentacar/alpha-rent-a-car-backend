const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'alpha-rent-a-car-secret-key';

// ============ AUTH MIDDLEWARE ============
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: 'Access denied' });
  
  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.admin = verified;
    next();
  } catch (err) {
    res.status(403).json({ error: 'Invalid token' });
  }
}

// ============ HEALTH CHECK ============
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Alpha Rent A Car API is running',
    timestamp: new Date().toISOString()
  });
});

// ============ ADMIN LOGIN ============
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    if (email !== process.env.ADMIN_EMAIL) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const validPassword = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { email: email, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({ 
      success: true, 
      token: token,
      message: 'Login successful' 
    });
    
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ CREATE BOOKING (Public) ============
app.post('/api/bookings', async (req, res) => {
  try {
    const bookingData = req.body;
    
    if (!bookingData.booked_by || !bookingData.car_type) {
      return res.status(400).json({ error: 'Name and car type required' });
    }
    
    const { data, error } = await supabase
      .from('bookings')
      .insert([bookingData])
      .select();
    
    if (error) throw error;
    
    res.status(201).json({ 
      success: true, 
      message: 'Booking saved successfully',
      booking: data[0]
    });
    
  } catch (err) {
    console.error('Booking error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============ GET ALL BOOKINGS (Admin) ============
app.get('/api/bookings', authenticateToken, async (req, res) => {
  try {
    const { search, car_type, from_date, to_date } = req.query;
    
    let query = supabase.from('bookings').select('*').order('booking_date', { ascending: false });
    
    if (car_type) query = query.eq('car_type', car_type);
    if (from_date) query = query.gte('booking_date', from_date);
    if (to_date) query = query.lte('booking_date', to_date);
    if (search) {
      query = query.or(`booked_by.ilike.%${search}%,customer_phone.ilike.%${search}%,veh_number.ilike.%${search}%`);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    res.json({ success: true, bookings: data });
    
  } catch (err) {
    console.error('Fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============ GET SINGLE BOOKING (Admin) ============
app.get('/api/bookings/:id', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', req.params.id)
      .single();
    
    if (error) throw error;
    
    res.json({ success: true, booking: data });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ UPDATE BOOKING (Admin) ============
app.put('/api/bookings/:id', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .update(req.body)
      .eq('id', req.params.id)
      .select();
    
    if (error) throw error;
    
    res.json({ success: true, message: 'Booking updated', booking: data[0] });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ DELETE BOOKING (Admin) ============
app.delete('/api/bookings/:id', authenticateToken, async (req, res) => {
  try {
    const { error } = await supabase
      .from('bookings')
      .delete()
      .eq('id', req.params.id);
    
    if (error) throw error;
    
    res.json({ success: true, message: 'Booking deleted' });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ STATS (Admin) ============
app.get('/api/stats', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase.from('bookings').select('total_amount, booking_date, car_type');
    
    if (error) throw error;
    
    const totalRevenue = data.reduce((sum, b) => sum + (parseFloat(b.total_amount) || 0), 0);
    const totalBookings = data.length;
    
    const thisMonth = new Date().toISOString().slice(0, 7);
    const monthBookings = data.filter(b => b.booking_date && b.booking_date.startsWith(thisMonth));
    const monthRevenue = monthBookings.reduce((sum, b) => sum + (parseFloat(b.total_amount) || 0), 0);
    
    const carStats = {};
    data.forEach(b => {
      if (b.car_type) {
        carStats[b.car_type] = (carStats[b.car_type] || 0) + 1;
      }
    });
    
    res.json({
      success: true,
      stats: {
        totalRevenue,
        totalBookings,
        monthRevenue,
        monthBookings: monthBookings.length,
        carStats
      }
    });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Alpha Rent A Car API running on port ${PORT}`);
});
