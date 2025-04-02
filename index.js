import express from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { handleChatMessage } from "./chatMessage.js";

dotenv.config();
const app = express();
app.use(express.json());
app.use(
  cors({
    origin: "http://192.168.56.201:8081",
    credentials: true,
  })
);

export const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI("AIzaSyAorId8TXgxiTk0kW4wPzDzbU3rqpq25c8");

app.post("/api/v1/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!["HEALER", "PATIENT"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, password: hashedPassword, role },
    });

    res.json({ message: "User registered successfully!", user });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Error registering user" });
  }
});

app.post("/api/v1/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log(req.body);
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.status(200).json({ message: "Login successful!", token });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Error logging in" });
  }
});

app.get("/api/v1/healthcheck", (req, res) => {
  res.json({ message: "Healthcheck is working" });
});

const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) return res.status(401).json({ error: "Access denied" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    console.log(req.user);
    next();
  } catch {
    res.status(403).json({ error: "Invalid token" });
  }
};

app.get("/api/v1/profile", authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  res.json({ message: "Profile data", user });
});

app.post("/api/v1/save_user_preference", authenticate, async (req, res) => {
  try {
    const { questions, answers } = req.body;
    console.log(questions, answers);
    if (!questions || !answers) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
      });
    }

    const analysis = await getGeminiAnalysis(questions, answers);
    console.log(analysis);

    const savedResponse = await prisma.response.create({
      data: {
        userId: req.user.userId,
        answers: { questions, answers },
        analysis,
      },
    });
    console.log(savedResponse);
    res.status(200).json({
      success: true,
      analysis: {
        rating: analysis.rating,
        traits: analysis.traits,
        suggestions: analysis.suggestions,
        analysis: analysis.analysis,
      },
    });
  } catch (error) {
    console.error("Analysis error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      details: error.message,
    });
  }
});

const getGeminiAnalysis = async (questions, answers) => {
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

  const prompt = `
    Analyze these personality assessment responses and provide:
    1. Overall character rating (1-10 scale, 10 being most positive)
    2. Top 3 character traits with scores (1-10)
    3. Brief analysis paragraph
    4. 3 personalized suggestions

    Format requirements:
    - Rating must be between 1-10
    - Respond in perfect JSON format
    - Don't include any markdown or code fences

    Questions and Answers:
    ${questions
      .map((q, i) => `${q.text} - ${answers[q.id] || "No answer"}`)
      .join("\n")}

    Response format:
    {
      "rating": 7,
      "traits": [
        {"trait": "Optimism", "score": 8},
        {"trait": "Resilience", "score": 6}
      ],
      "analysis": "The user shows strong optimism but could work on resilience...",
      "suggestions": ["Practice mindfulness..."]
    }
  `;

  const result = await model.generateContent(prompt);
  const response = result.response;
  const text = response.text();

  try {
    const analysis = JSON.parse(text);
    if (!analysis.rating || !analysis.traits) {
      throw new Error("Invalid analysis format from AI");
    }
    return analysis;
  } catch (parseError) {
    console.error("Failed to parse AI response:", text);
    throw new Error("AI returned invalid format");
  }
};

// In your backend controller
app.post("/api/v1/emotional_support_chat", authenticate, async (req, res) => {
  try {
    const { message, chatHistory = [], isFirstMessage = false } = req.body;

    const user = await prisma.user.findFirst({
      where: { id: req.user.userId },
      include: {
        Analysis: {
          select: { traits: true },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const response = await handleChatMessage({
      userId: req.user.userId,
      message: {
        role: "user",
        content: message,
      },
      traits: user?.Analysis?.traits || [],
      chatHistory,
      isFirstMessage,
    });

    res.status(200).json(response);
  } catch (error) {
    console.error("Chat endpoint error:", error);
    res.status(500).json({
      success: false,
      message: "Couldn't process your message",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
