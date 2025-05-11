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
  const { from, to, gender } = req.query;
  if (!from || !to || !gender) {
    return res
      .status(400)
      .json({ error: 'Missing "from" or "to" or "gender" query parameters.' });
  }

  try {
    const db = mongoose.connection.db;

    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T23:59:59.999Z`);

    // ✅ Top-level stats using createdAt and feedbackFiles size check
    const systemOverview = await db
      .collection("assignmentpassdatas")
      .aggregate([
        {
          $match: {
            createdAt: {
              $gte: fromDate,
              $lte: toDate,
            },
          },
        },
        {
          $group: {
            _id: null,
            totalAssignments: { $sum: 1 },
            gradedAssignments: {
              $sum: {
                $cond: [
                  { $gt: [{ $size: { $ifNull: ["$feedbackFiles", []] } }, 0] },
                  1,
                  0,
                ],
              },
            },
            ungradedAssignments: {
              $sum: {
                $cond: [
                  { $eq: [{ $size: { $ifNull: ["$feedbackFiles", []] } }, 0] },
                  1,
                  0,
                ],
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

    // ✅ Per-teacher graded assignments only (non-empty feedbackFiles)
    const matchGenderRole = {
      role: "teacher",
      ...(gender.toLowerCase() !== "all" && {
        gender: { $regex: `^${gender}$`, $options: "i" },
      }),
    };

    const teacherWorkRaw = await db
      .collection("users")
      .aggregate([
        {
          $match: matchGenderRole,
        },
        {
          $lookup: {
            from: "assignmentpassdatas",
            let: { teacherId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$teacher", "$$teacherId"] },
                      { $gte: ["$createdAt", fromDate] },
                      { $lte: ["$createdAt", toDate] },
                      {
                        $gt: [
                          { $size: { $ifNull: ["$feedbackFiles", []] } },
                          0,
                        ],
                      },
                    ],
                  },
                },
              },
            ],
            as: "gradedAssignments",
          },
        },
        {
          $project: {
            _id: 0,
            teacher: {
              $concat: ["$firstName", " ", "$lastName"],
            },
            assignmentsGraded: { $size: "$gradedAssignments" },
          },
        },
        {
          $sort: { assignmentsGraded: -1 },
        },
      ])
      .toArray();

    // ✅ Add sequence IDs (1-based)
    const teacherWork = teacherWorkRaw.map((item, index) => ({
      id: index + 1,
      ...item,
    }));

    // ✅ Ensure fallback if no stats found
    const system = systemOverview[0] || {
      totalAssignments: 0,
      gradedAssignments: 0,
      ungradedAssignments: 0,
    };

    // ✅ Final response
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
