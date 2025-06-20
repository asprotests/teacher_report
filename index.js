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
    const toDate = new Date(`${to}T00:00:00.000Z`);

    const systemOverview = await db
      .collection("assignmentpassdatas")
      .aggregate([
        {
          $match: {
            createdAt: { $gte: fromDate, $lte: toDate },
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "student",
            foreignField: "_id",
            as: "studentInfo",
          },
        },
        { $unwind: "$studentInfo" },
        ...(gender.toLowerCase() !== "all"
          ? [
              {
                $match: {
                  "studentInfo.gender": {
                    $regex: `^${gender}$`,
                    $options: "i",
                  },
                },
              },
            ]
          : []),
        {
          $group: {
            _id: null,
            totalAssignments: { $sum: 1 },
            gradedAssignments: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      {
                        $gt: [
                          { $size: { $ifNull: ["$feedbackFiles", []] } },
                          0,
                        ],
                      },
                      {
                        $and: [
                          { $ne: ["$feedback", null] },
                          { $ne: ["$feedback", ""] },
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            ungradedAssignments: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          { $size: { $ifNull: ["$feedbackFiles", []] } },
                          0,
                        ],
                      },
                      {
                        $or: [
                          { $eq: ["$feedback", null] },
                          { $eq: ["$feedback", ""] },
                        ],
                      },
                    ],
                  },
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

    const teacherWorkRaw = await db
      .collection("users")
      .aggregate([
        {
          $match: {
            role: "teacher",
            ...(gender.toLowerCase() !== "all" && {
              gender: { $regex: `^${gender}$`, $options: "i" },
            }),
          },
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
                        $or: [
                          {
                            $gt: [
                              { $size: { $ifNull: ["$feedbackFiles", []] } },
                              0,
                            ],
                          },
                          {
                            $and: [
                              { $ne: ["$feedback", null] },
                              { $ne: ["$feedback", ""] },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                },
              },
              {
                $lookup: {
                  from: "users",
                  localField: "student",
                  foreignField: "_id",
                  as: "studentInfo",
                },
              },
              { $unwind: "$studentInfo" },
              ...(gender.toLowerCase() !== "all"
                ? [
                    {
                      $match: {
                        "studentInfo.gender": {
                          $regex: `^${gender}$`,
                          $options: "i",
                        },
                      },
                    },
                  ]
                : []),
            ],
            as: "gradedAssignments",
          },
        },
        {
          $project: {
            _id: 0,
            teacher: {
              $trim: {
                input: {
                  $reduce: {
                    input: ["$firstName", "$middleName", "$lastName"],
                    initialValue: "",
                    in: {
                      $cond: [
                        { $eq: ["$$value", ""] },
                        "$$this",
                        { $concat: ["$$value", " ", "$$this"] },
                      ],
                    },
                  },
                },
              },
            },
            assignmentsGraded: { $size: "$gradedAssignments" },
          },
        },
        { $sort: { assignmentsGraded: -1 } },
      ])
      .toArray();

    const teacherWork = teacherWorkRaw.map((item, index) => ({
      id: index + 1,
      ...item,
      teacher: item.teacher
        ? item.teacher.trim().replace(/\s+/g, " ")
        : "Unnamed Teacher",
    }));

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

app.get("/quran-teacher-report/survey", async (req, res) => {
  const { from, to } = req.query;

  if (!from || !to) {
    return res
      .status(400)
      .json({ error: 'Missing "from" or "to" query parameters!' });
  }

  try {
    const db = mongoose.connection.db;
    const collection = db.collection("qurandownloadsurvey");

    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T23:59:59.999Z`);

    const rawData = await collection
      .find({
        type: "agent",
        createdAt: { $gte: fromDate, $lte: toDate },
      })
      .toArray();

    const agentMap = {
      1001: "Cabdinuur Ciise Aaadan",
      1002: "Cumar Cabdikaafi Axmed",
      1003: "Saadaq Shariif Faarax",
      1004: "Xasan Salaad Tarabi",
    };

    const report = {};
    let other = { agent: "Other Agents", android: 0, ios: 0 };

    for (const doc of rawData) {
      const id = doc.agentId;
      if (!id) continue;

      const isIOS = /^[0-9A-Fa-f]{8}-/.test(doc.deviceId);
      const platform = isIOS ? "ios" : "android";

      if (agentMap[id]) {
        if (!report[id]) {
          report[id] = { agent: agentMap[id], android: 0, ios: 0 };
        }
        report[id][platform]++;
      } else {
        other[platform]++;
      }
    }

    const result = Object.values(report).map((agent) => ({
      ...agent,
      total: agent.android + agent.ios,
    }));

    if (other.android > 0 || other.ios > 0) {
      other.total = other.android + other.ios;
      result.push(other);
    }

    res.json(result);
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
