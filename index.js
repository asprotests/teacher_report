const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(helmet());

// MongoDB Connection
const mongoUri = process.env.MONGO_URI;
console.log('🚀 Connecting to', mongoUri);

mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB connected successfully'))
.catch((err) => {
  console.error('❌ MongoDB connection failed:', err);
  process.exit(1);
});

// Models
const Assignment = require('./models/Assignment');

// Redirect root to /quran-teacher-report/
app.get('/', (req, res) => {
  res.redirect('/quran-teacher-report/');
});

// Serve static files under /quran-teacher-report
app.use('/quran-teacher-report', express.static(path.join(__dirname, 'public')));

// API endpoint for report generation
app.get('/quran-teacher-report/report', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: 'Missing "from" or "to" query parameters.' });
  }

  try {
    const db = mongoose.connection.db;
    const collection = db.collection('assignmentpassdatas');

    const data = await collection.aggregate([
      {
        $match: {
          updatedAt: {
            $gte: new Date(from),
            $lte: new Date(to),
          },
        },
      },
      {
        $group: {
          _id: '$name',
          assignmentsGraded: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          name: '$_id',
          assignmentsGraded: 1,
        },
      },
    ]).toArray();

    if (!data.length) {
      return res.status(404).json({ message: 'No data found' });
    }

    res.json(data);
  } catch (err) {
    console.error('Error generating report:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Start the server
const PORT = process.env.PORT || 8585;
app.listen(PORT, () => {
  console.log(`📊 Teacher Report Server running on port ${PORT}`);
});
