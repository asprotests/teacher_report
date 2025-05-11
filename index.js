const express = require("express");
const mongoose = require("mongoose");
const helmet = require("helmet");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();

// Configure CORS to allow requests from your frontend domain
const corsOptions = {
  origin: "https://quran-tabsera.vercel.app",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(helmet());

// MongoDB Connection
const mongoUri = process.env.MONGO_URI;
console.log("🚀 Connecting to", mongoUri);

mongoose
  .connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB connected successfully"))
  .catch((err) => {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
  });

// Redirect root to /quran-teacher-report/
app.get("/", (req, res) => {
  res.redirect("/quran-teacher-report/");
});

// Serve static files under /quran-teacher-report
app.use(
  "/quran-teacher-report",
  express.static(path.join(__dirname, "public"))
);

// API endpoint for report generation
app.get("/quran-teacher-report/report", async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) {
    return res
      .status(400)
      .json({ error: 'Missing "from" or "to" query parameters.' });
  }

  try {
    const db = mongoose.connection.db;

    const systemOverview = await db
      .collection("assignmentpassdatas")
      .aggregate([
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
            _id: null,
            totalAssignments: { $sum: 1 },
            gradedAssignments: {
              $sum: {
                $cond: [{ $ne: ["$feedbackFiles", null] }, 1, 0],
              },
            },
            ungradedAssignments: {
              $sum: {
                $cond: [{ $eq: ["$feedbackFiles", null] }, 1, 0],
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            totalAssignments: 1,
            gradedAssignments: 1,
            ungradedAssignments: 1,
          },
        },
      ])
      .toArray();

    const teacherWork = await db
      .collection("assignmentpassdatas")
      .aggregate([
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
            _id: "$teacher",
            assignmentsGraded: { $sum: 1 },
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "teacherInfo",
          },
        },
        {
          $unwind: "$teacherInfo",
        },
        {
          $project: {
            _id: 0,
            teacher: {
              $concat: ["$teacherInfo.firstName", " ", "$teacherInfo.lastName"],
            },
            assignmentsGraded: 1,
          },
        },
      ])
      .toArray();

    const system = systemOverview[0] || {
      totalAssignments: 0,
      gradedAssignments: 0,
      ungradedAssignments: 0,
    };

    res.json({
      ...system,
      teachers: teacherWork,
    });
  } catch (err) {
    console.error("Error generating report:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Start the server
const PORT = process.env.PORT || 8585;
app.listen(PORT, () => {
  console.log(`📊 Teacher Report Server running on port ${PORT}`);
});
