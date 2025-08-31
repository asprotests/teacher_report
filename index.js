const express = require("express");
const mongoose = require("mongoose");
const helmet = require("helmet");
const cors = require("cors");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const users = require("./users");
require("dotenv").config();

const app = express();

const SECRET_KEY = process.env.JWT_SECRET;

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

// Middleware: authenticate token
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Token missing" });

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid token" });
    req.user = user;
    next();
  });
}

// Middleware: authorize by role
function authorizeRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role)
      return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

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

// Login route
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const user = users.find((u) => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign(
    { username: user.username, role: user.role },
    SECRET_KEY,
    { expiresIn: "1h" }
  );
  res.json({ token });
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
app.get("/quran-teacher-report/report", authenticateToken, async (req, res) => {
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

app.get("/quran-teacher-report/survey", authenticateToken, async (req, res) => {
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
    const toDate = new Date(`${to}T00:00:00.000Z`);

    const rawData = await collection
      .find({ createdAt: { $gte: fromDate, $lte: toDate } })
      .toArray();

    const agentMap = {
      1001: "Cabdinuur Ciise Aaadan",
      1002: "Cumar Cabdikaafi Axmed",
      1003: "Saadaq Shariif Faarax",
      1004: "Xasan Salaad Tarabi",
      2000: "Team Hamza Campaign",
    };

    // Initialize result map with all 8 entries
    const resultMap = {
      1001: { agent: agentMap[1001], android: 0, ios: 0 },
      1002: { agent: agentMap[1002], android: 0, ios: 0 },
      1003: { agent: agentMap[1003], android: 0, ios: 0 },
      1004: { agent: agentMap[1004], android: 0, ios: 0 },
      otherAgents: { agent: "Other Agents", android: 0, ios: 0 },
      social: { agent: "Social Media", android: 0, ios: 0 },
      friend: { agent: "Friend", android: 0, ios: 0 },
      other: { agent: "Other", android: 0, ios: 0 },
    };

    for (const doc of rawData) {
      const isIOS = /^[0-9A-Fa-f]{8}-/.test(doc.deviceId);
      const platform = isIOS ? "ios" : "android";

      if (doc.type === "agent") {
        const id = doc.agentId;
        if (agentMap[id]) {
          resultMap[id][platform]++;
        } else {
          resultMap.otherAgents[platform]++;
        }
      } else if (doc.type === "social media") {
        resultMap.social[platform]++;
      } else if (doc.type === "friend") {
        resultMap.friend[platform]++;
      } else if (doc.type === "other") {
        resultMap.other[platform]++;
      }
    }

    // Convert to list and compute totals
    const resultList = Object.values(resultMap).map((row) => ({
      ...row,
      total: row.android + row.ios,
    }));

    // Sort rows (excluding Total row)
    resultList.sort((a, b) => b.total - a.total);

    // Compute final Total row
    const totalRow = resultList.reduce(
      (acc, row) => {
        acc.android += row.android;
        acc.ios += row.ios;
        acc.total += row.total;
        return acc;
      },
      { agent: "Total", android: 0, ios: 0, total: 0 }
    );

    // Append total as 9th row
    resultList.push(totalRow);

    res.json(resultList);
  } catch (err) {
    console.error("Error generating report:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get(
  "/quran-teacher-report/submissions",
  authenticateToken,
  authorizeRole("admin"),
  async (req, res) => {
    const { from, to, teacher } = req.query;

    if (!from || !to || !teacher) {
      return res.status(400).json({
        error: 'Missing "from", "to", or "teacher" query parameters!',
      });
    }

    try {
      const db = mongoose.connection.db;
      const collection = db.collection("assignmentpassdatas");

      const fromDate = new Date(`${from}T00:00:00.000Z`);
      const toDate = new Date(`${to}T00:00:00.000Z`);

      const data = await collection
        .aggregate([
          {
            $match: {
              createdAt: { $gte: fromDate, $lte: toDate },
              status: { $in: ["passed", "failed"] },
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
          {
            $lookup: {
              from: "users",
              localField: "teacher",
              foreignField: "_id",
              as: "teacherInfo",
            },
          },
          { $unwind: "$teacherInfo" },
          {
            $addFields: {
              teacherFullName: {
                $trim: {
                  input: {
                    $reduce: {
                      input: [
                        "$teacherInfo.firstName",
                        "$teacherInfo.middleName",
                        "$teacherInfo.lastName",
                      ],
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
            },
          },
          {
            $match: {
              teacherFullName: teacher,
            },
          },
          {
            $project: {
              _id: 0,
              studentName: {
                $trim: {
                  input: {
                    $reduce: {
                      input: [
                        "$studentInfo.firstName",
                        "$studentInfo.middleName",
                        "$studentInfo.lastName",
                      ],
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
              submissionUrl: {
                $cond: [
                  { $gt: [{ $size: { $ifNull: ["$attachments", []] } }, 0] },
                  { $arrayElemAt: ["$attachments.url", 0] },
                  null,
                ],
              },
              status: "$status",
              teacherResponseAudio: {
                $cond: [
                  { $gt: [{ $size: { $ifNull: ["$feedbackFiles", []] } }, 0] },
                  { $arrayElemAt: ["$feedbackFiles.url", -1] },
                  null,
                ],
              },
              teacherResponseText: {
                $cond: [
                  { $eq: [{ $size: { $ifNull: ["$feedbackFiles", []] } }, 0] },
                  "$feedback",
                  null,
                ],
              },
            },
          },
        ])
        .toArray();

      res.json(data);
    } catch (err) {
      console.error("Error fetching submissions:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

// Start the server
const PORT = process.env.PORT || 8585;
app.listen(PORT, () => {
  console.log(`📊 Teacher Report Server running on port ${PORT}`);
});
