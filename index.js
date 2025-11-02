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
  const { from, to, gender, onlyActivity } = req.query;

  if (!from || !to || !gender) {
    return res
      .status(400)
      .json({ error: 'Missing "from", "to", or "gender" query parameters.' });
  }

  // ✅ Fix: Properly handle query string and field usage
  const isActivity = String(onlyActivity).toLowerCase() == "true";
  const filter = isActivity ? "updatedAt" : "createdAt"; // used for normal $match
  const filterExpr = `$${filter}`; // used for $expr inside pipelines
  console.log(onlyActivity, isActivity, filter, filterExpr);

  try {
    const db = mongoose.connection.db;
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T00:00:00.000Z`);

    const teacherNames = [
      "Ahmed Abdulkarim Almasry",
      "Kaltuun Cabdullaahi Aadan",
      "Rahma Abdinur Ali",
      "Umulkheyr Hussein Abdullah",
      "Maymun Hussein Mohamed",
      "Aisha Omar Hussein",
      "Cabdinuur Ciise Aadan",
      "Abdullahi Osman Farah",
      "Abdullahi Mohamed Ahmed",
      "Cabdul Qaadir Markaawi",
    ].map((n) => n.trim().toLowerCase());

    // ===== SYSTEM OVERVIEW =====
    const systemOverview = await db
      .collection("assignmentpassdatas")
      .aggregate([
        {
          $match: {
            [filter]: { $gte: fromDate, $lte: toDate },
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

    // ===== TEACHER REPORT =====
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
          $addFields: {
            fullName: {
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
          },
        },
        {
          $match: {
            $expr: {
              $in: [{ $toLower: "$fullName" }, teacherNames],
            },
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
                      { $gte: [filterExpr, fromDate] }, // ✅ use $updatedAt or $createdAt correctly
                      { $lte: [filterExpr, toDate] },
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
            teacher: "$fullName",
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

    // ===== FINAL RESPONSE =====
    res.json({
      ...system,
      teachers: teacherWork,
    });
  } catch (err) {
    console.error("Error generating report:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Survey endpoint with new agents added
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
      10: "Awees Sh Nuur",
      15: "Ibra Hakiim",
      20: "Macalin Muse",
      25: "Daaci Nabiil",
      30: "Teacher Mahad",
      35: "Run Kudhiigle",
      40: "Wadad Yare",
      45: "Macalin Ismaaciil",
      55: "Daaci Cabdullaahi",
      60: "Xasan Khaliif",
      65: "Maxamed Macalin",
      70: "Daaci Xasan",
      75: "Cabdiraxmaan Khaliil",
      85: "Brother Maalin",
    };

    const resultMap = {
      10: { agent: agentMap[10], android: 0, ios: 0 },
      15: { agent: agentMap[15], android: 0, ios: 0 },
      20: { agent: agentMap[20], android: 0, ios: 0 },
      25: { agent: agentMap[25], android: 0, ios: 0 },
      30: { agent: agentMap[30], android: 0, ios: 0 },
      35: { agent: agentMap[35], android: 0, ios: 0 },
      40: { agent: agentMap[40], android: 0, ios: 0 },
      45: { agent: agentMap[45], android: 0, ios: 0 },
      55: { agent: agentMap[55], android: 0, ios: 0 },
      60: { agent: agentMap[60], android: 0, ios: 0 },
      65: { agent: agentMap[65], android: 0, ios: 0 },
      70: { agent: agentMap[70], android: 0, ios: 0 },
      75: { agent: agentMap[75], android: 0, ios: 0 },
      85: { agent: agentMap[85], android: 0, ios: 0 },
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

    const resultList = Object.values(resultMap).map((row) => ({
      ...row,
      total: row.android + row.ios,
    }));

    resultList.sort((a, b) => b.total - a.total);

    const totalRow = resultList.reduce(
      (acc, row) => {
        acc.android += row.android;
        acc.ios += row.ios;
        acc.total += row.total;
        return acc;
      },
      { agent: "Total", android: 0, ios: 0, total: 0 }
    );

    resultList.push(totalRow);

    res.json(resultList);
  } catch (err) {
    console.error("Error generating report:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Submissions endpoint
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
