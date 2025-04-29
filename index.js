const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');

require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(helmet());


// Serve frontend at /quran-teacher-report route
app.use('/quran-teacher-report', express.static(path.join(__dirname, 'public')));


const mongoUri = process.env.MONGO_URI;


console.log('🚀 Connecting to', process.env.MONGO_URI);

mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB connected successfully'))
  .catch((err) => {
    console.error('❌ MongoDB connection failed:', err);
    process.exit(1);  
});


const Assignment = require('./models/Assignment');

app.get('/quran-teacher-report/', async (req, res) => {
  const { from, to } = req.query;
  try {
    const query = {
      gradedAt: {
        $gte: new Date(from),
        $lte: new Date(to)
      }
    };
    const data = await Assignment.aggregate([
      { $match: query },
      { $group: { _id: '$name', count: { $sum: 1 } } },
      { $project: { _id: 0, name: '$_id', assignmentsGraded: '$count' } }
    ]);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

const PORT = process.env.PORT || 8585;
app.listen(PORT, () => console.log(`Teacher Report Server running on port ${PORT}`));
