import "dotenv/config";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import multer from "multer";
import { ObjectId } from "mongodb";
import { getDb, getProductImageBucket } from "./db.js";

const app = express();
const port = Number(process.env.PORT || 5000);
const pythonCommand = process.env.PYTHON_PATH || "python";
const predictionScript = fileURLToPath(new URL("../ml/predict.py", import.meta.url));
const isVercelRuntime = Boolean(globalThis.process?.env?.VERCEL);

app.use(cors());
app.use(express.json());

const uploadProductImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 },
  fileFilter: (_request, file, callback) => {
    callback(null, file.mimetype.startsWith("image/"));
  },
});

const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone || "",
  role: user.role || "user",
});

const createToken = () => crypto.randomBytes(32).toString("hex");

async function createSession(user) {
  const database = await getDb();
  const token = createToken();
  await database.collection("sessions").insertOne({
    token,
    userId: user._id,
    createdAt: new Date(),
  });
  return token;
}

async function getUserFromRequest(request) {
  const token = request.headers.authorization?.startsWith("Bearer ")
    ? request.headers.authorization.slice(7)
    : "";
  if (!token) return null;

  const database = await getDb();
  const session = await database.collection("sessions").findOne({ token });
  if (!session) return null;

  return database.collection("users").findOne({ _id: session.userId });
}

async function requireUser(request, response, next) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }
    request.user = user;
    next();
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
}

async function requireAdmin(request, response, next) {
  await requireUser(request, response, () => {
    if (request.user.role !== "admin") {
      response.status(403).json({ error: "Admin access required." });
      return;
    }
    next();
  });
}

app.post("/api/auth/signup", async (request, response) => {
  const name = String(request.body.name || "").trim();
  const email = String(request.body.email || "").trim().toLowerCase();
  const password = String(request.body.password || "");
  const role = request.body.role === "admin" ? "admin" : "user";

  if (!name || !email || !password) {
    response.status(400).json({ error: "Name, email, and password are required." });
    return;
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    response.status(400).json({ error: "Please enter a valid email address." });
    return;
  }
  if (password.length < 6) {
    response.status(400).json({ error: "Password must be at least 6 characters." });
    return;
  }

  try {
    const database = await getDb();
    const existingUser = await database.collection("users").findOne({ email });
    if (existingUser) {
      response.status(409).json({ error: "An account with this email already exists." });
      return;
    }

    const user = {
      name,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role,
      createdAt: new Date(),
    };
    const result = await database.collection("users").insertOne(user);
    user._id = result.insertedId;
    const token = await createSession(user);
    response.status(201).json({ token, user: publicUser(user) });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post("/api/auth/signin", async (request, response) => {
  const email = String(request.body.email || "").trim().toLowerCase();
  const password = String(request.body.password || "");
  const requestedRole = request.body.role === "admin" ? "admin" : "user";

  if (!email || !password) {
    response.status(400).json({ error: "Email and password are required." });
    return;
  }

  try {
    const database = await getDb();
    const user = await database.collection("users").findOne({ email });
    const validPassword = user && await bcrypt.compare(password, user.passwordHash);
    if (!validPassword || user.role !== requestedRole) {
      response.status(401).json({ error: "Invalid email or password." });
      return;
    }

    const token = await createSession(user);
    response.json({ token, user: publicUser(user) });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.get("/api/auth/me", async (request, response) => {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }
    response.json({ user: publicUser(user) });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post("/api/auth/signout", async (request, response) => {
  const token = request.headers.authorization?.startsWith("Bearer ")
    ? request.headers.authorization.slice(7)
    : "";
  try {
    if (token) {
      const database = await getDb();
      await database.collection("sessions").deleteOne({ token });
    }
    response.json({ ok: true });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.get("/api/health", async (_request, response) => {
  try {
    const database = await getDb();
    await database.command({ ping: 1 });
    response.json({ ok: true, database: "connected" });
  } catch (error) {
    response.status(503).json({ ok: false, error: error.message });
  }
});

app.post("/api/ai/chat", requireUser, async (request, response) => {
  const message = String(request.body.message || "").trim();
  const history = Array.isArray(request.body.history) ? request.body.history.slice(-8) : [];
  if (!message) {
    response.status(400).json({ error: "A question is required." });
    return;
  }
  if (!process.env.GROQ_API_KEY) {
    response.status(503).json({ error: "AI assistant is not configured. Add GROQ_API_KEY to .env." });
    return;
  }

  try {
    const database = await getDb();
    const products = await database.collection("products")
      .find({}, { projection: { name: 1, price: 1, grade: 1, co2: 1, category: 1, material: 1, packagingType: 1 } })
      .limit(50)
      .toArray();
    const catalogContext = products.map((product) => ({
      name: product.name,
      price: product.price,
      grade: product.grade,
      co2Kg: product.co2,
      category: product.category,
      material: product.material,
      packaging: product.packagingType,
    }));
    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        temperature: 0.3,
        max_tokens: 500,
        messages: [
          {
            role: "system",
            content: `You are EcoChoice's sustainability shopping assistant. Answer questions about the products, their CO2 values and grades, environmental choices, and how this website works. Be concise, practical, and honest. Use only the catalog data for specific product claims. Do not invent prices, CO2 values, certifications, or product features. If a question is unrelated, politely say you can help with EcoChoice, products, orders, and sustainability. Current catalog: ${JSON.stringify(catalogContext)}`,
          },
          ...history.filter((item) => ["user", "assistant"].includes(item.role) && typeof item.content === "string"),
          { role: "user", content: message },
        ],
      }),
    });
    const data = await groqResponse.json();
    if (!groqResponse.ok) {
      response.status(502).json({ error: data.error?.message || "The AI assistant could not answer right now." });
      return;
    }
    response.json({ answer: data.choices?.[0]?.message?.content || "I could not generate an answer." });
  } catch (error) {
    response.status(502).json({ error: error.message });
  }
});

app.get("/api/products", async (_request, response) => {
  try {
    const database = await getDb();
    const products = await database.collection("products").find({}).sort({ createdAt: -1 }).toArray();
    response.json(products);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

const getProductPayload = (body) => ({
  name: String(body.name || "").trim(),
  price: Number(body.price),
  emoji: String(body.emoji || "🛍️").trim(),
  grade: String(body.grade || "").trim().toUpperCase(),
  co2: Number(body.co2),
  category: String(body.category || "").trim(),
  material: String(body.material || "").trim(),
  productWeight: Number(body.productWeight),
  packagingType: String(body.packagingType || "").trim(),
});

const productCategories = [
  "Food Products", "Beverages", "Food & Staples Retailing", "Computers & Peripherals",
  "Office Electronics", "Electronic Equipment, Instruments & Components", "Communications Equipment",
  "Semiconductors & Semiconductor Equipment", "Household Durables", "Textiles, Apparel & Luxury Goods",
  "Containers & Packaging", "Paper & Forest Products", "Chemicals", "Electrical Equipment",
  "Machinery", "Automobiles & Components", "Materials", "Consumer Durables & Apparel",
];
const productMaterials = [
  "Cotton", "Organic cotton", "Bamboo", "Steel", "Aluminum", "Plastic", "Glass", "Paper",
  "Cardboard", "Wood", "Rubber", "Leather", "Ceramic", "Electronics", "Mixed materials", "Unknown",
];
const productPackaging = [
  "Cardboard", "Recycled cardboard", "Paper", "Paper bag", "Plastic", "Recycled plastic",
  "Plastic bag", "Glass", "Aluminum can", "Steel can", "Mixed packaging", "None", "Unknown",
];

const isValidProduct = ({ name, price, emoji, grade, co2, category, material, productWeight, packagingType }) => (
  Boolean(name && emoji && productCategories.includes(category) && productMaterials.includes(material) && productPackaging.includes(packagingType) && ["A", "B", "C", "D", "E", "F"].includes(grade))
  && Number.isFinite(price) && price >= 0
  && Number.isFinite(co2) && co2 >= 0
  && Number.isFinite(productWeight) && productWeight > 0
);

const estimateProductCo2 = ({ category, material, productWeight, packagingType }) => {
  const materialFactors = {
    Bamboo: 0.8,
    "Organic cotton": 1.2,
    Cotton: 1.8,
    Paper: 0.9,
    Cardboard: 0.7,
    Wood: 1.1,
    Glass: 1.4,
    Aluminum: 2.2,
    Steel: 1.8,
    Plastic: 2.4,
    Electronics: 4.2,
    Leather: 3.6,
  };
  const packagingFactors = {
    None: 0,
    Paper: 0.1,
    "Paper bag": 0.15,
    Cardboard: 0.2,
    "Recycled cardboard": 0.12,
    Plastic: 0.35,
    "Recycled plastic": 0.2,
    "Plastic bag": 0.3,
    Glass: 0.4,
    "Aluminum can": 0.3,
    "Steel can": 0.25,
    "Mixed packaging": 0.35,
  };
  const categoryFactors = {
    "Food Products": 1.1,
    Beverages: 1.1,
    "Computers & Peripherals": 1.25,
    "Office Electronics": 1.2,
    "Communications Equipment": 1.2,
    Automobiles: 1.3,
  };
  const weightKg = Number(productWeight) / 1000;
  const estimatedCo2 = Math.max(
    0.05,
    weightKg * (materialFactors[material] || 1.8) * (categoryFactors[category] || 1) + (packagingFactors[packagingType] || 0.25)
  );
  const grade = estimatedCo2 <= 1 ? "A" : estimatedCo2 <= 2 ? "B" : estimatedCo2 <= 3.5 ? "C" : estimatedCo2 <= 4.5 ? "D" : estimatedCo2 <= 5.5 ? "E" : "F";
  return {
    estimatedCo2: Number(estimatedCo2.toFixed(3)),
    grade,
    confidence: 0.55,
    randomForestCo2: Number(estimatedCo2.toFixed(3)),
    xgboostCo2: Number(estimatedCo2.toFixed(3)),
    validation: {
      source: "production fallback estimate; trained Python model is used outside Vercel",
      modelVersion: 2,
    },
  };
};

const predictProductCo2 = (payload) => new Promise((resolve, reject) => {
  if (isVercelRuntime) {
    resolve(estimateProductCo2(payload));
    return;
  }
  const childProcess = spawn(pythonCommand, [predictionScript], { windowsHide: true });
  let output = "";
  let errorOutput = "";
  childProcess.stdout.on("data", (chunk) => { output += chunk; });
  childProcess.stderr.on("data", (chunk) => { errorOutput += chunk; });
  childProcess.on("error", (error) => reject(new Error(`Could not start the scoring model: ${error.message}`)));
  childProcess.on("close", (code) => {
    if (code !== 0) {
      reject(new Error(errorOutput.trim() || "The scoring model failed."));
      return;
    }
    try {
      const result = JSON.parse(output);
      if (result.error) throw new Error(result.error);
      resolve(result);
    } catch (error) {
      reject(error);
    }
  });
  childProcess.stdin.end(JSON.stringify(payload));
});

const parseProductImage = (request, response, next) => {
  uploadProductImage.single("image")(request, response, (error) => {
    if (!error) {
      next();
      return;
    }
    if (error.code === "LIMIT_FILE_SIZE") {
      response.status(400).json({ error: "Product images must be 150 KB or smaller." });
      return;
    }
    response.status(400).json({ error: "Please upload a valid image file." });
  });
};

const saveProductImage = async (file) => {
  if (!file) return null;
  const bucket = await getProductImageBucket();
  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(file.originalname, {
      contentType: file.mimetype,
      metadata: { kind: "product-image" },
    });
    uploadStream.on("error", reject);
    uploadStream.on("finish", () => resolve(uploadStream.id));
    uploadStream.end(file.buffer);
  });
};

const deleteProductImage = async (imageId) => {
  if (!imageId) return;
  const bucket = await getProductImageBucket();
  try {
    await bucket.delete(imageId);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
};

app.post("/api/products/predict-co2", requireAdmin, async (request, response) => {
  const { category, material, productWeight, packagingType } = request.body;
  if (!category || !material || !packagingType || Number(productWeight) <= 0) {
    response.status(400).json({ error: "Category, material, positive product weight, and packaging type are required." });
    return;
  }
  try {
    response.json(await predictProductCo2({ category, material, productWeight: Number(productWeight) / 1000, packagingType }));
  } catch (error) {
    response.status(503).json({ error: error.message });
  }
});

app.post("/api/products", requireAdmin, parseProductImage, async (request, response) => {
  const product = getProductPayload(request.body);
  if (!isValidProduct(product)) {
    response.status(400).json({ error: "Name, price, category, material, weight, packaging, grade, and CO₂ are required." });
    return;
  }

  try {
    const database = await getDb();
    const imageId = await saveProductImage(request.file);
    const record = { ...product, ...(imageId ? { imageId } : {}), createdAt: new Date(), updatedAt: new Date() };
    const result = await database.collection("products").insertOne(record);
    response.status(201).json({ ...record, _id: result.insertedId });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.patch("/api/products/:id", requireAdmin, parseProductImage, async (request, response) => {
  const product = getProductPayload(request.body);
  if (!ObjectId.isValid(request.params.id)) {
    response.status(400).json({ error: "Invalid product id." });
    return;
  }
  if (!isValidProduct(product)) {
    response.status(400).json({ error: "Name, price, category, material, weight, packaging, grade, and CO₂ are required." });
    return;
  }

  try {
    const database = await getDb();
    const existingProduct = await database.collection("products").findOne({ _id: new ObjectId(request.params.id) });
    if (!existingProduct) {
      response.status(404).json({ error: "Product not found." });
      return;
    }
    const imageId = await saveProductImage(request.file);
    const result = await database.collection("products").findOneAndUpdate(
      { _id: new ObjectId(request.params.id) },
      { $set: { ...product, ...(imageId ? { imageId } : {}), updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!result) {
      response.status(404).json({ error: "Product not found." });
      return;
    }
    if (imageId && existingProduct.imageId) await deleteProductImage(existingProduct.imageId);
    response.json(result);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.delete("/api/products/:id", requireAdmin, async (request, response) => {
  if (!ObjectId.isValid(request.params.id)) {
    response.status(400).json({ error: "Invalid product id." });
    return;
  }

  try {
    const database = await getDb();
    const product = await database.collection("products").findOne({ _id: new ObjectId(request.params.id) });
    const result = await database.collection("products").deleteOne({ _id: new ObjectId(request.params.id) });
    if (!result.deletedCount) {
      response.status(404).json({ error: "Product not found." });
      return;
    }
    if (product?.imageId) await deleteProductImage(product.imageId);
    response.json({ ok: true });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.get("/api/user/data", requireUser, async (request, response) => {
  try {
    const database = await getDb();
    const [cart, wishlist, orders] = await Promise.all([
      database.collection("carts").findOne({ userId: request.user._id }),
      database.collection("wishlists").findOne({ userId: request.user._id }),
      database.collection("orders").find({ userId: request.user._id }).sort({ createdAt: -1 }).toArray(),
    ]);
    response.json({
      cart: cart?.items || [],
      wishlist: wishlist?.items || [],
      orders,
    });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.put("/api/user/cart", requireUser, async (request, response) => {
  const items = Array.isArray(request.body.items) ? request.body.items : [];
  try {
    const database = await getDb();
    await database.collection("carts").updateOne(
      { userId: request.user._id },
      { $set: { userId: request.user._id, items, updatedAt: new Date() } },
      { upsert: true }
    );
    response.json({ items });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.put("/api/user/wishlist", requireUser, async (request, response) => {
  const items = Array.isArray(request.body.items) ? request.body.items : [];
  try {
    const database = await getDb();
    await database.collection("wishlists").updateOne(
      { userId: request.user._id },
      { $set: { userId: request.user._id, items, updatedAt: new Date() } },
      { upsert: true }
    );
    response.json({ items });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post("/api/orders", requireUser, async (request, response) => {
  const items = Array.isArray(request.body.items) ? request.body.items : [];
  if (!items.length) {
    response.status(400).json({ error: "At least one cart item is required." });
    return;
  }

  try {
    const database = await getDb();
    const order = {
      userId: request.user._id,
      orderNumber: `EBX-${Date.now().toString().slice(-8)}`,
      items,
      subtotal: Number(request.body.subtotal) || 0,
      discount: Number(request.body.discount) || 0,
      total: Number(request.body.total) || 0,
      co2: Number(request.body.co2) || 0,
      status: "Placed",
      createdAt: new Date(),
    };
    const result = await database.collection("orders").insertOne(order);
    await database.collection("carts").updateOne(
      { userId: request.user._id },
      { $set: { items: [], updatedAt: new Date() } },
      { upsert: true }
    );
    response.status(201).json({ ...order, _id: result.insertedId });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

if (!isVercelRuntime) {
  app.listen(port, () => {
    console.log(`EcoChoice API running at http://localhost:${port}`);
  });
}

app.patch("/api/auth/profile", requireUser, async (request, response) => {
  const name = String(request.body.name || "").trim();
  const email = String(request.body.email || "").trim().toLowerCase();
  const phone = String(request.body.phone || "").trim();

  if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) {
    response.status(400).json({ error: "A valid name and email are required." });
    return;
  }

  try {
    const database = await getDb();
    const existingUser = await database.collection("users").findOne({
      email,
      _id: { $ne: request.user._id },
    });
    if (existingUser) {
      response.status(409).json({ error: "That email is already in use." });
      return;
    }

    await database.collection("users").updateOne(
      { _id: request.user._id },
      { $set: { name, email, phone, updatedAt: new Date() } }
    );
    const updatedUser = await database.collection("users").findOne({ _id: request.user._id });
    response.json({ user: publicUser(updatedUser) });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.patch("/api/auth/password", requireUser, async (request, response) => {
  const currentPassword = String(request.body.currentPassword || "");
  const newPassword = String(request.body.newPassword || "");

  if (!currentPassword || newPassword.length < 6) {
    response.status(400).json({ error: "Current password and a new 6-character password are required." });
    return;
  }

  try {
    const validPassword = await bcrypt.compare(currentPassword, request.user.passwordHash);
    if (!validPassword) {
      response.status(401).json({ error: "Current password is incorrect." });
      return;
    }
    const database = await getDb();
    await database.collection("users").updateOne(
      { _id: request.user._id },
      { $set: { passwordHash: await bcrypt.hash(newPassword, 12), updatedAt: new Date() } }
    );
    response.json({ ok: true });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.get("/api/admin/users", requireAdmin, async (_request, response) => {
  try {
    const database = await getDb();
    const users = await database.collection("users")
      .find({}, { projection: { passwordHash: 0 } })
      .sort({ createdAt: -1 })
      .toArray();
    response.json({ users: users.map(publicUser) });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.get("/api/admin/orders", requireAdmin, async (_request, response) => {
  try {
    const database = await getDb();
    const orders = await database.collection("orders").find({}).sort({ createdAt: -1 }).toArray();
    const userIds = [...new Set(orders.map((order) => String(order.userId)))].map((id) => new ObjectId(id));
    const users = await database.collection("users").find({ _id: { $in: userIds } }).toArray();
    const usersById = new Map(users.map((account) => [String(account._id), account]));
    response.json({
      orders: orders.map((order) => {
        const account = usersById.get(String(order.userId));
        return {
          ...order,
          customer: account ? { name: account.name, email: account.email } : { name: "Unknown user", email: "" },
        };
      }),
    });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.get("/api/products/:id/image", async (request, response) => {
  if (!ObjectId.isValid(request.params.id)) {
    response.status(400).json({ error: "Invalid product id." });
    return;
  }
  try {
    const database = await getDb();
    const product = await database.collection("products").findOne({ _id: new ObjectId(request.params.id) });
    if (!product?.imageId) {
      response.status(404).json({ error: "Product image not found." });
      return;
    }
    const bucket = await getProductImageBucket();
    const imageFile = await bucket.find({ _id: product.imageId }).next();
    if (!imageFile) {
      response.status(404).json({ error: "Product image not found." });
      return;
    }
    response.setHeader("Content-Type", imageFile.contentType || "application/octet-stream");
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    bucket.openDownloadStream(product.imageId).pipe(response);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.get("/api/version", (_request, response) => {
  response.json({ version: "809e00b", scoring: isVercelRuntime ? "vercel-fallback" : "python-model" });
});

export default app;

app.use("/api", (_request, response) => {
  response.status(404).json({ error: "API route not found. Restart the backend server." });
});