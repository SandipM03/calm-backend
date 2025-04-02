import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "./index.js";

const genAI = new GoogleGenerativeAI("AIzaSyAorId8TXgxiTk0kW4wPzDzbU3rqpq25c8");

export const handleChatMessage = async ({
  userId,
  message,
  traits = [],
  chatHistory = [],
  isFirstMessage = false,
}) => {
  console.log(message);
  try {
    const session = await manageChatSession(userId, message);

    const text = await generateAIResponse({
      userId,
      message: message.content,
      traits,
      chatHistory: session.messages,
      isFirstMessage,
    });

    await updateSessionWithResponse(session.id, text);

    return {
      success: true,
      message: text,
      sessionId: session.id,
    };
  } catch (error) {
    console.error("Chat processing error:", error);
    return handleErrorResponse(error);
  }
};

const manageChatSession = async (userId, message) => {
  if (!userId) throw new Error("User ID is required");

  const existingSession = await prisma.chatSession.findFirst({
    where: { userId },
    select: { id: true },
  });

  if (existingSession) {
    return await prisma.chatSession.update({
      where: { id: existingSession.id },
      data: {
        messages: {
          push: createMessageObject(message),
        },
        updatedAt: new Date(),
      },
    });
  } else {
    return await prisma.chatSession.create({
      data: {
        userId,
        messages: [createMessageObject(message)],
        updatedAt: new Date(),
      },
    });
  }
};
const getExistingMessages = async (userId) => {
  const session = await prisma.chatSession.findFirst({
    where: { userId },
    select: { messages: true },
  });
  return session?.messages || [];
};

const createMessageObject = (message) => ({
  role: message.role || "user",
  content: message.content,
  timestamp: new Date(),
});

const generateAIResponse = async ({
  userId,
  message,
  traits,
  chatHistory,
  isFirstMessage,
}) => {
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-pro",
    });

  const prompt = buildSupportPrompt({
    message,
    traits,
    chatHistory,
    isFirstMessage,
  });

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    if (!text || text.length > 500) {
      throw new Error("Invalid response from AI");
    }

    return text;
  } catch (aiError) {
    console.error("AI generation error:", aiError);
    throw new Error("AI service unavailable");
  }
};

const getSafetySettings = () => [
  {
    category: "HARM_CATEGORY_DANGEROUS",
    threshold: "BLOCK_NONE",
  },
  {
    category: "HARM_CATEGORY_HARASSMENT",
    threshold: "BLOCK_NONE",
  },
];

const getGenerationConfig = () => ({
  maxOutputTokens: 500,
  temperature: 0.7,
});

const updateSessionWithResponse = async (sessionId, responseText) => {
  await prisma.chatSession.update({
    where: { id: sessionId },
    data: {
      messages: {
        push: createMessageObject({
          role: "assistant",
          content: responseText,
        }),
      },
      updatedAt: new Date(),
    },
  });
};

export const fallbackResponses = [
  "I'm having trouble finding the right words. How are you feeling right now?",
  "Let's pause for a moment. What emotion are you experiencing most strongly?",
  "I want to be fully present for you. Could you rephrase what you're sharing?",
  "I'm feeling a bit overwhelmed right now. Could you tell me more about how you're feeling?",
  "It seems I'm having difficulty responding properly. Could you share more about what's on your mind?",
];

const handleErrorResponse = (error) => ({
  success: false,
  message:
    fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)],
  error: process.env.NODE_ENV === "development" ? error.message : undefined,
});

export const buildSupportPrompt = ({
  message,
  traits,
  chatHistory,
  isFirstMessage,
}) => {
  const traitsDisplay = formatTraits(traits);
  const context = buildConversationContext(chatHistory);

  return `
  You are CalmAI, an emotional support companion. ${
    isFirstMessage ? "This is the first message from the user." : ""
  }

  User Personality Traits:
  ${traitsDisplay}

  Conversation Context:
  ${context}

  Guidelines:
  1. Start with emotional validation
  2. Offer 1 relevant coping strategy
  3. Keep response under 3 sentences
  4. Reference traits when helpful
  5. Focus on feelings, not solutions

  Current Message:
  "${message}"
  `;
};

const formatTraits = (traits) => {
  if (!traits || traits.length === 0) {
    return "No personality traits analyzed yet";
  }
  return traits.map((t) => `• ${t.trait}: ${t.score}/10`).join("\n");
};

const buildConversationContext = (messages) => {
  if (!messages || messages.length === 0) return "No recent conversation";

  const lastMessages = messages.length > 5 && messages.slice(-5);
  return (
    lastMessages.length > 0 &&
    lastMessages
      .map((m) => `${m?.role === "user" ? "User" : "AI"}: ${m?.content}`)
      .join("\n")
  );
};
