import React, { useEffect, useState } from "react";
import "./App.css";

const API_BASE = "http://localhost:5000";
const AUTH_TOKEN_KEY = "ecobazaarx_auth_token";

const PRODUCTS = [
  { n: "Mixed Seeds Trail Mix (250g)", e: "🥗", p: 349, g: "A", co2: 0.4 },
  { n: "Bamboo Toothbrush Set (4pk)", e: "🪥", p: 249, g: "A", co2: 0.3 },
  { n: "Organic Cotton Tote Bag", e: "👜", p: 399, g: "B", co2: 0.9 },
  { n: "Solar Power Bank 10000mAh", e: "🔋", p: 1499, g: "B", co2: 1.6 },
  { n: "Recycled Notebook Set", e: "📓", p: 299, g: "A", co2: 0.5 },
  { n: "Steel Water Bottle 1L", e: "🚰", p: 599, g: "A", co2: 0.7 },
];

const ECO_FACTS = [
  "A reusable water bottle can replace hundreds of single-use plastic bottles each year.",
  "Bamboo grows quickly and can be harvested without killing the plant.",
  "Repairing products usually creates less waste than replacing them.",
  "Reusable shopping bags help reduce plastic waste from everyday purchases.",
  "Buying durable products can reduce the environmental cost of frequent replacements.",
  "Recycled paper uses less energy and water than making paper from fresh wood pulp.",
  "LED bulbs use much less electricity than traditional incandescent bulbs.",
  "Plant-based meals generally use less water and land than meat-based meals.",
  "Washing clothes in cold water can reduce household energy use.",
  "Choosing nearby products can reduce emissions from long-distance transportation.",
];

const PRODUCT_CATEGORIES = [
  "Food Products", "Beverages", "Food & Staples Retailing", "Computers & Peripherals",
  "Office Electronics", "Electronic Equipment, Instruments & Components", "Communications Equipment",
  "Semiconductors & Semiconductor Equipment", "Household Durables", "Textiles, Apparel & Luxury Goods",
  "Containers & Packaging", "Paper & Forest Products", "Chemicals", "Electrical Equipment",
  "Machinery", "Automobiles & Components", "Materials", "Consumer Durables & Apparel",
];

const PRODUCT_MATERIALS = [
  "Cotton", "Organic cotton", "Bamboo", "Steel", "Aluminum", "Plastic", "Glass", "Paper",
  "Cardboard", "Wood", "Rubber", "Leather", "Ceramic", "Electronics", "Mixed materials", "Unknown",
];

const PRODUCT_PACKAGING = [
  "Cardboard", "Recycled cardboard", "Paper", "Paper bag", "Plastic", "Recycled plastic",
  "Plastic bag", "Glass", "Aluminum can", "Steel can", "Mixed packaging", "None", "Unknown",
];

const fmt = (n) => "₹" + n.toLocaleString("en-IN");

const getInitials = (name) => name
  .trim()
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0].toUpperCase())
  .join("");

const SEARCH_SYNONYMS = {
  laptop: ["laptop", "computer", "computers", "notebook", "pc"],
  computer: ["computer", "computers", "laptop", "notebook", "pc"],
  phone: ["phone", "mobile", "smartphone", "communications"],
  mobile: ["mobile", "phone", "smartphone", "communications"],
  cellphone: ["phone", "mobile", "smartphone"],
  clothing: ["clothing", "apparel", "textile", "cotton"],
  clothes: ["clothing", "apparel", "textile"],
  food: ["food", "beverage", "snack", "staples"],
  drink: ["drink", "beverage", "bottle", "water"],
};

const searchTokens = (value) => String(value || "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .split(/\s+/)
  .filter(Boolean);

const getProductSearchScore = (product, query) => {
  const queryTokens = searchTokens(query);
  if (!queryTokens.length) return 1;
  const fields = [product.n, product.category, product.material, product.packagingType, product.e].map(searchTokens);
  const searchableText = fields.flat().join(" ");
  return queryTokens.reduce((score, queryToken) => {
    const terms = SEARCH_SYNONYMS[queryToken] || [queryToken];
    const bestMatch = terms.reduce((best, term) => {
      if (searchableText.includes(term)) return Math.max(best, term === queryToken ? 4 : 3);
      const fieldMatch = fields.some((field) => field.some((word) => word.startsWith(term) || term.startsWith(word)));
      return Math.max(best, fieldMatch ? 2 : 0);
    }, 0);
    return score + bestMatch;
  }, 0);
};

const getSaferAlternative = (product, products) => products
  .filter((candidate) => (
    candidate.id !== product.id
    && candidate.category
    && product.category
    && candidate.category.toLowerCase() === product.category.toLowerCase()
    && Number(candidate.co2) < Number(product.co2)
  ))
  .map((candidate) => ({
    candidate,
    nameSimilarity: searchTokens(product.n).filter((token) => searchTokens(candidate.n).includes(token)).length,
  }))
  .sort((a, b) => b.nameSimilarity - a.nameSimilarity || Number(a.candidate.co2) - Number(b.candidate.co2))[0]?.candidate || null;

const getEcoDiscount = (cart, products) => cart.reduce((discount, item) => {
  const itemCo2 = Number(item.co2);
  const itemPrice = Number(item.p);
  const itemQuantity = Number(item.qty || 0);
  if (!item.category || !Number.isFinite(itemCo2) || !Number.isFinite(itemPrice) || itemQuantity <= 0) return discount;

  const choseLowerCarbonOption = products.some((candidate) => (
    candidate.id !== item.id
    && candidate.category
    && String(candidate.category).toLowerCase() === String(item.category).toLowerCase()
    && Number(candidate.co2) > itemCo2
  ));

  return choseLowerCarbonOption ? discount + itemPrice * itemQuantity * 0.05 : discount;
}, 0);

const toProduct = (product) => ({
  id: String(product._id || product.id || product.n || product.name),
  n: product.n || product.name,
  e: product.e || product.emoji,
  p: product.p ?? product.price,
  g: product.g || product.grade,
  co2: product.co2,
  category: product.category || "",
  material: product.material || "",
  productWeight: product.productWeight,
  packagingType: product.packagingType || "",
  image: product.imageId ? `${API_BASE}/api/products/${String(product._id || product.id)}/image` : "",
});

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}`,
});

const authOnlyHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}`,
});

const readApiResponse = async (response) => {
  const body = await response.text();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("The API server is not responding. Restart `npm run server` and try again.");
  }
  return body ? JSON.parse(body) : {};
};

const getEcoGrade = (orders) => {
  const orderedItems = orders.flatMap((order) => order.items || []);
  if (!orderedItems.length) return { grade: "A", label: "Start your eco journey" };
  const orderedQuantity = orderedItems.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const averageCo2 = orderedQuantity
    ? orderedItems.reduce((sum, item) => sum + Number(item.co2 || 0) * Number(item.qty || 0), 0) / orderedQuantity
    : 0;
  if (averageCo2 <= 1) return { grade: "A", label: "Excellent" };
  if (averageCo2 <= 2) return { grade: "B", label: "Good" };
  if (averageCo2 <= 3.5) return { grade: "C", label: "Average" };
  if (averageCo2 <= 4.5) return { grade: "D", label: "Needs improvement" };
  if (averageCo2 <= 5.5) return { grade: "E", label: "Choose greener products" };
  return { grade: "F", label: "Very high impact" };
};

const getAchievementStats = (cart, wishlist, orders) => {
  const orderedItems = orders.flatMap((order) => order.items || []);
  const currentCartCount = cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const orderedItemCount = orderedItems.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const orderedCo2 = orderedItems.reduce(
    (sum, item) => sum + Number(item.co2 || 0) * Number(item.qty || 0),
    0
  );
  const orderedAverageCo2 = orderedItemCount ? orderedCo2 / orderedItemCount : 0;

  return {
    cartCount: currentCartCount,
    wishlistCount: wishlist.length,
    hasOrderedItem: orderedItemCount > 0,
    orderedItemCount,
    totalActivityCount: currentCartCount + orderedItemCount,
    orderCount: orders.length,
    orderedCo2,
    orderedAverageCo2,
  };
};

const getHomeChartData = (orders) => {
  const categoryTotals = new Map();
  orders.forEach((order) => {
    (order.items || []).forEach((item) => {
      const quantity = Number(item.qty || 0);
      const co2 = Number(item.co2 || 0) * quantity;
      const category = item.category || "Other";
      categoryTotals.set(category, (categoryTotals.get(category) || 0) + co2);
    });
  });
  const sortedCategories = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]);
  const topCategories = sortedCategories.slice(0, 8);
  const otherTotal = sortedCategories.slice(8).reduce((sum, [, value]) => sum + value, 0);
  return {
    categories: otherTotal > 0 ? [...topCategories, ["Other", otherTotal]] : topCategories,
  };
};

const NAV = [
  { id: "home", label: "🏠 Home" },
  { id: "products", label: "🛍️ Products" },
  { id: "wishlist", label: "🤍 Wishlist" },
  { id: "cart", label: "🛒 Cart" },
  { id: "profile", label: "👤 Profile" },
];

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [page, setPage] = useState("home");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [products, setProducts] = useState(PRODUCTS);
  const [cart, setCart] = useState([]);
  const [wishlist, setWishlist] = useState([]);
  const [orders, setOrders] = useState([]);
  const [orderMessage, setOrderMessage] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiProduct, setAiProduct] = useState(null);
  const [ecoRecommendation, setEcoRecommendation] = useState(null);
  const [savingsMessage, setSavingsMessage] = useState("");
  const [dataLoading, setDataLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!token) {
      setAuthLoading(false);
      return;
    }

    fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Session expired");
        return response.json();
      })
      .then(({ user: signedInUser }) => setUser(signedInUser))
      .catch(() => localStorage.removeItem(AUTH_TOKEN_KEY))
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    const headers = authHeaders();
    setDataLoading(true);
    Promise.all([
      fetch(`${API_BASE}/api/products`).then((response) => response.json()),
      fetch(`${API_BASE}/api/user/data`, { headers }).then((response) => response.json()),
    ])
      .then(([productData, userData]) => {
        if (Array.isArray(productData)) {
          setProducts(productData.map(toProduct));
        }
        setCart((userData.cart || []).map((item) => ({ ...toProduct(item), qty: item.qty })));
        setWishlist((userData.wishlist || []).map(toProduct));
        setOrders(userData.orders || []);
      })
      .catch(() => {})
      .finally(() => setDataLoading(false));
  }, [user]);

  const handleAuthed = ({ token, user: signedInUser }) => {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    setUser(signedInUser);
  };

  const handleLogout = async () => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) {
      await fetch(`${API_BASE}/api/auth/signout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setUser(null);
    setCart([]);
    setWishlist([]);
    setOrders([]);
  };

  if (authLoading) {
    return <div className="auth-loading">Loading your EcoChoice account...</div>;
  }

  if (!user) {
    return <AuthPage onAuthed={handleAuthed} />;
  }

  if (user.role === "admin") {
    return <AdminPage user={user} onLogout={handleLogout} />;
  }

  const goto = (id) => {
    setPage(id);
    setSidebarOpen(false);
    window.scrollTo(0, 0);
  };

  const saveUserList = (path, items) => {
    fetch(`${API_BASE}${path}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ items }),
    }).catch(() => {});
  };

  const toggleWish = (p) => {
    setWishlist((w) => {
      const next = w.some((x) => x.n === p.n) ? w.filter((x) => x.n !== p.n) : [...w, p];
      saveUserList("/api/user/wishlist", next);
      return next;
    });
  };

  const addToCart = (p, comparedTo = null) => {
    if (!p || !p.n) return;
    setCart((c) => {
      const line = c.find((x) => x.n === p.n);
      const next = line
        ? c.map((x) => (x.n === p.n ? { ...x, qty: Number(x.qty || 0) + 1 } : x))
        : [...c, { ...p, qty: 1 }];
      saveUserList("/api/user/cart", next);
      return next;
    });
    const selectedPrice = Number(p.p);
    const comparedPrice = Number(comparedTo?.p);
    if (comparedTo && Number.isFinite(selectedPrice) && Number.isFinite(comparedPrice) && comparedPrice > selectedPrice) {
      setSavingsMessage(`Yay! You saved ${fmt(Math.round(comparedPrice - selectedPrice))} by choosing ${p.n}, the lower-carbon option.`);
    } else {
      setSavingsMessage("");
    }
    const greenerAlternative = products
      .filter((product) => product.id !== p.id && product.category && p.category && String(product.category).toLowerCase() === String(p.category).toLowerCase() && Number(product.co2) < Number(p.co2))
      .sort((a, b) => Number(a.co2) - Number(b.co2))[0];
    setEcoRecommendation(greenerAlternative ? { chosen: p, alternative: greenerAlternative } : null);
  };

  const changeQty = (i, d) => {
    setCart((c) => {
      const next = [...c];
      next[i] = { ...next[i], qty: next[i].qty + d };
      const filtered = next.filter((x) => x.qty > 0);
      saveUserList("/api/user/cart", filtered);
      return filtered;
    });
  };

  const removeLine = (i) => setCart((c) => {
    const next = c.filter((_, idx) => idx !== i);
    saveUserList("/api/user/cart", next);
    return next;
  });
  const clearCart = () => {
    setCart([]);
    saveUserList("/api/user/cart", []);
  };

  const placeOrder = async () => {
    if (!cart.length) return;
    try {
      const response = await fetch(`${API_BASE}/api/orders`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ items: cart, subtotal, discount, total, co2 }),
      });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.error || "Could not place your order.");
      setOrders((current) => [data, ...current]);
      setCart([]);
      saveUserList("/api/user/cart", []);
      setOrderMessage(`Order #${data.orderNumber} placed successfully.`);
    } catch (error) {
      alert(error.message);
    }
  };

  const subtotal = cart.reduce((a, c) => a + Number(c.p || 0) * Number(c.qty || 0), 0);
  const discount = Math.round(getEcoDiscount(cart, products));
  const total = subtotal - discount;
  const co2 = cart.reduce((a, c) => a + Number(c.co2 || 0) * Number(c.qty || 0), 0).toFixed(2);
  const cartCount = cart.reduce((a, c) => a + Number(c.qty || 0), 0);

  return (
    <div className="app">
      <aside className={"sidebar" + (sidebarOpen ? " open" : "")}>
        <div className="brand">
          <span className="logo">🌿</span>Eco<span className="eco">Choice</span>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <a
              key={item.id}
              className={"nav-item" + (page === item.id ? " active" : "")}
              onClick={() => goto(item.id)}
            >
              {item.label}
              {item.id === "home" && <span className="dot" />}
            </a>
          ))}
        </nav>
        <a className="logout" onClick={handleLogout}>↩ Logout</a>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="crumb">
            <button className="menu-btn" onClick={() => setSidebarOpen((o) => !o)}>☰</button>
            🌐 ECOCHOICE &nbsp;·&nbsp; <b>{page.toUpperCase()}</b>
          </div>
        </div>
        {savingsMessage && <div className="savings-message"><strong>🌱 Great choice!</strong><span>{savingsMessage}</span><button onClick={() => setSavingsMessage("")} aria-label="Dismiss savings message">×</button></div>}
        {ecoRecommendation && <div className="eco-recommendation"><div><strong>🌿 Greener option available</strong><span>{ecoRecommendation.chosen.n} has {ecoRecommendation.chosen.co2} kg CO₂. Try {ecoRecommendation.alternative.n} from the same category at {ecoRecommendation.alternative.co2} kg CO₂.</span></div><button onClick={() => { addToCart(ecoRecommendation.alternative, ecoRecommendation.chosen); setEcoRecommendation(null); }}>Add greener option</button><button className="recommend-close" onClick={() => setEcoRecommendation(null)} aria-label="Dismiss recommendation">×</button></div>}

        {page === "home" && (
          <HomePage user={user} cart={cart} wishlist={wishlist} orders={orders} goto={goto} />
        )}

        {page === "products" && (
          <ProductsPage products={products} wishlist={wishlist} toggleWish={toggleWish} addToCart={addToCart} onExplainProduct={(product) => { setAiProduct(product); setAiOpen(true); }} />
        )}

        {page === "wishlist" && (
          <WishlistPage wishlist={wishlist} toggleWish={toggleWish} addToCart={addToCart} />
        )}

        {page === "cart" && (
          <CartPage
            cart={cart}
            changeQty={changeQty}
            removeLine={removeLine}
            clearCart={clearCart}
            placeOrder={placeOrder}
            subtotal={subtotal}
            discount={discount}
            total={total}
            co2={co2}
            orderMessage={orderMessage}
            goto={goto}
          />
        )}

        {page === "profile" && <ProfilePage user={user} orders={orders} onUserUpdated={setUser} />}

        <div className="ai-widget">
          {aiOpen && <AIAssistant product={aiProduct} onClose={() => { setAiOpen(false); setAiProduct(null); }} />}
          <button className="fab" onClick={() => setAiOpen((open) => !open)} aria-label={aiOpen ? "Close AI sustainability assistant" : "Open AI sustainability assistant"}>🌿</button>
        </div>
      </main>
    </div>
  );
}

function AIAssistant({ product, onClose }) {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! Ask me about our products, CO₂ scores, sustainability, or how EcoChoice works." },
  ]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const sendQuestion = async (question) => {
    if (!question || loading) return;
    const nextMessages = [...messages, { role: "user", content: question }];
    setMessages(nextMessages);
    setMessage("");
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/ai/chat`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ message: question, history: messages }),
      });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.error || "The assistant could not answer.");
      setMessages([...nextMessages, { role: "assistant", content: data.answer }]);
    } catch (error) {
      setMessages([...nextMessages, { role: "assistant", content: error.message }]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!product) return;
    sendQuestion(`Explain why ${product.n} has a carbon grade of ${product.g} and a CO2 score of ${product.co2} kg. Use its category (${product.category || "unknown"}), material (${product.material || "unknown"}), packaging (${product.packagingType || "unknown"}), and product weight (${product.productWeight || "unknown"}). Explain the main factors simply and mention that the score is an estimate.`);
  }, [product]);

  const askAssistant = (event) => {
    event.preventDefault();
    sendQuestion(message.trim());
    setMessage("");
  };

  return (
    <section className="ai-panel" aria-label="EcoChoice AI assistant">
      <div className="ai-head"><div><strong>🌿 Eco Assistant</strong><span>Groq-powered sustainability help</span></div><button onClick={onClose} aria-label="Close assistant">×</button></div>
      <div className="ai-messages">
        {messages.map((item, index) => <div className={"ai-message " + item.role} key={`${item.role}-${index}`}>{item.content}</div>)}
        {loading && <div className="ai-message assistant">Thinking...</div>}
      </div>
      <form className="ai-form" onSubmit={askAssistant}>
        <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ask about a product or CO₂..." aria-label="Ask the sustainability assistant" />
        <button type="submit" disabled={loading || !message.trim()} aria-label="Send question">↑</button>
      </form>
    </section>
  );
}

function HomePage({ user, cart, wishlist, orders, goto }) {
  const [factIndex, setFactIndex] = useState(0);
  const achievementStats = getAchievementStats(cart, wishlist, orders);
  const chartData = getHomeChartData(orders);
  const cartCount = achievementStats.cartCount;
  const cartTotal = cart.reduce((a, c) => a + c.p * c.qty, 0);
  const ecoGrade = getEcoGrade(orders);
  const badges = [
    { icon: "🌱", title: "Eco Explorer", desc: "Welcome to EcoChoice!", unlocked: true },
    { icon: "🤍", title: "Wishlist Starter", desc: "Save 1 item to your wishlist", unlocked: achievementStats.wishlistCount >= 1 },
    { icon: "🤍", title: "Wishlist Lover", desc: "Save 5 items to your wishlist", unlocked: achievementStats.wishlistCount >= 5 },
    { icon: "🛒", title: "First Cart Item", desc: "Add your first item to the cart", unlocked: achievementStats.totalActivityCount >= 1 },
    { icon: "🏆", title: "Power Shopper", desc: "Add or purchase 5 items", unlocked: achievementStats.totalActivityCount >= 5 },
    { icon: "📦", title: "First Order", desc: "Place your first order", unlocked: achievementStats.orderCount >= 1 },
    { icon: "♻️", title: "CO₂ Saver", desc: "Keep ordered products below 2 kg CO₂ each", unlocked: achievementStats.hasOrderedItem && achievementStats.orderedAverageCo2 < 2 },
  ];
  const unlockedCount = badges.filter((b) => b.unlocked).length;

  useEffect(() => {
    const factTimer = setInterval(() => {
      setFactIndex((current) => (current + 1) % ECO_FACTS.length);
    }, 5000);
    return () => clearInterval(factTimer);
  }, []);

  return (
    <section className="page">
      <div className="card hero">
        <div className="hero-left">
          <div className="avatar">{getInitials(user.name)}</div>
          <div>
            <div className="eyebrow">WELCOME BACK</div>
            <h1>Hey, {user.name.split(" ")[0]}! 👋</h1>
            <p>Here's your eco-shopping snapshot for today.</p>
          </div>
        </div>
        <div className="grade-box">
          <small>YOUR ECO GRADE</small>
          <div className="g">{ecoGrade.grade}</div>
          <small>{ecoGrade.label}</small>
        </div>
      </div>

      <div className="card promise">
        <div>
          <div className="eyebrow">PLATFORM PROMISE</div>
          <h2>Why EcoChoice? 🌐</h2>
        </div>
        <span className="pill">🌱 100% CO₂-scored products</span>
        <span className="pill">💬 AI greener swap suggestions</span>
        <span className="pill">🏷️ Transparent A–F carbon grades</span>
        <span className="pill">✅ Zero greenwashing</span>
      </div>

      <div className="card fact" key={factIndex}>
        <span className="tag">🌿 ECO FACT</span> {ECO_FACTS[factIndex]}
      </div>

      <div className="stats">
        <div className="card"><div className="stat-label">🛒 CART ITEMS</div><div className="stat-num">{cartCount}</div><div className="stat-sub">{fmt(cartTotal)} total</div></div>
        <div className="card"><div className="stat-label">❤️ WISHLIST SAVED</div><div className="stat-num">{wishlist.length}</div><div className="stat-sub">items saved</div></div>
        <div className="card"><div className="stat-label">📦 ORDERS PLACED</div><div className="stat-num">{achievementStats.orderCount}</div><div className="stat-sub">{achievementStats.orderedItemCount} items purchased</div></div>
        <div className="card"><div className="stat-label">♻️ ORDER CO₂</div><div className="stat-num">{achievementStats.orderedCo2.toFixed(1)}</div><div className="stat-sub">kg tracked so far</div></div>
      </div>

      <HomeAnalytics chartData={chartData} />

      <div className="row2">
        <div className="card">
          <div className="card-head">🛒 CART REMINDER <a onClick={() => goto("cart")}>View Cart →</a></div>
          {cart[0] ? (
            <>
              <div className="cart-line">
                <div className="thumb">{cart[0].e}</div>
                <div><div className="name">{cart[0].n}</div><div className="sub">{fmt(cart[0].p)} × {cart[0].qty}</div></div>
                <div className="price">{fmt(cart[0].p * cart[0].qty)}</div>
              </div>
              <div className="total-row"><span>{cartCount} item{cartCount === 1 ? "" : "s"}</span><b style={{ color: "var(--text)" }}>{fmt(cartTotal)}</b></div>
              <button className="btn-primary" onClick={() => goto("cart")}>Go to Checkout →</button>
            </>
          ) : (
            <div className="empty"><div className="icon">🛒</div><h3>Cart is empty</h3><button className="btn-mini" onClick={() => goto("products")}>Discover Products</button></div>
          )}
        </div>
        <div className="card">
          <div className="card-head">❤️ WISHLIST SPOTLIGHT <a onClick={() => goto("wishlist")}>View All →</a></div>
          {wishlist.length === 0 ? (
            <div className="empty"><div className="icon">🤍</div><h3>Nothing saved yet</h3><button className="btn-mini" onClick={() => goto("products")}>Discover Products</button></div>
          ) : (
            <div className="cart-line" style={{ borderBottom: "none" }}>
              <div className="thumb">{wishlist[0].e}</div>
              <div><div className="name">{wishlist[0].n}</div><div className="sub">{fmt(wishlist[0].p)}</div></div>
            </div>
          )}
        </div>
      </div>

      <div className="cat-title">📁 BROWSE BY CATEGORY</div>
      <div className="chips">
        {["Electronics", "Clothing", "Food", "Furniture", "Appliances", "Toys", "Books", "Sports", "Beauty"].map((c) => (
          <span className="chip" key={c}>{c}</span>
        ))}
      </div>

      <div className="card">
        <div className="ach-head"><h2>🏅 ECO ACHIEVEMENTS</h2><span>{unlockedCount} / {badges.length} unlocked</span></div>
        <div className="progress"><i style={{ width: (unlockedCount / badges.length) * 100 + "%" }} /></div>
        <div className="badges">
          {badges.map((b) => (
            <div className={"badge" + (b.unlocked ? "" : " locked")} key={b.title}>
              <div className="bicon">{b.icon}</div>
              <h4>{b.title}</h4>
              <p>{b.desc}</p>
              <span className="tag">{b.unlocked ? "✓ Unlocked" : "Locked"}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HomeAnalytics({ chartData }) {
  const maxCategoryCo2 = Math.max(...chartData.categories.map(([, value]) => value), 1);

  if (!chartData.categories.length) {
    return <div className="card analytics-empty"><strong>📊 Your category footprint will appear here</strong><span>Place an order to compare the carbon footprint of your purchased product categories.</span></div>;
  }
  return (
    <section className="analytics-grid">
      <div className="card chart-card category-chart"><div className="chart-title">📊 CARBON FOOTPRINT BY PRODUCT CATEGORY</div><div className="chart-note">Highest-impact categories appear first · total purchased-product footprint in kg CO₂e</div><div className="bar-chart category-bars">{chartData.categories.map(([category, value]) => <div className="bar-item" key={category}><div className="bar-value">{value.toFixed(1)} kg</div><div className="bar-track"><i style={{ height: `${Math.max(6, (value / maxCategoryCo2) * 100)}%` }} /></div><span title={category}>{category}</span></div>)}</div></div>
    </section>
  );
}

function ProductCard({ p, liked, onWish, onAdd, onExplain, saferAlternative, showRemove = false }) {
  const [showSafer, setShowSafer] = useState(false);

  return (
    <div className="prod-card">
      <div className="thumb product-image-wrap">
        {p.image ? <img className="product-image" src={p.image} alt={p.n} /> : p.e}
      </div>
      <h4>{p.n}</h4>
      <div className="meta"><span className={"grade-pill g" + p.g} style={{ padding: "2px 8px", fontSize: 10 }}>{p.g}</span><span>{p.co2} kg CO₂</span></div>
      {onExplain && <button className="why-score-btn" onClick={onExplain}>🌿 Why this score?</button>}
      {saferAlternative && (
        showSafer ? (
          <div className="safer-alternative">
            <div><strong>Safer alternative</strong><span>{saferAlternative.n} · {saferAlternative.co2} kg CO₂</span></div>
            <button className="safer-btn" onClick={() => onAdd(saferAlternative, p)}>Choose safer</button>
          </div>
        ) : <button className="safer-btn safer-toggle" onClick={() => setShowSafer(true)}>Safer alternative</button>
      )}
      <div className="foot">
        <span className="price">{fmt(p.p)}</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button className={"icon-btn" + (liked ? " liked" : "")} onClick={onWish}>♥</button>
          <button className="add-btn" type="button" onClick={() => onAdd()}>Add</button>
          {showRemove && <button className="add-btn" onClick={onWish}>Remove</button>}
        </div>
      </div>
    </div>
  );
}

function ProductsPage({ products, wishlist, toggleWish, addToCart, onExplainProduct }) {
  const [query, setQuery] = useState("");
  const filteredProducts = products
    .map((product) => ({ product, score: getProductSearchScore(product, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ product }) => product);

  return (
    <section className="page">
      <div className="page-title">🛍️ Products</div>
      <div className="page-sub">Click <span className="green">🌿 Why this score?</span> on any product for an AI sustainability breakdown</div>
      <div className="search-row"><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && event.preventDefault()} placeholder="Search products, categories, or materials..." aria-label="Search products" /><button className="btn-search" type="button">Search</button></div>
      <div className="legend">
        <span className="lbl">Carbon Grade:</span>
        <span className="grade-pill gA">A — Excellent ≤1.0</span>
        <span className="grade-pill gB">B — Good ≤2.0</span>
        <span className="grade-pill gC">C — Average ≤3.5</span>
        <span className="grade-pill gD">D — Poor ≤4.5</span>
        <span className="grade-pill gE">E — Very Poor ≤5.5</span>
        <span className="grade-pill gF">F — High CO₂ &gt;5.5</span>
      </div>
      <div className="prod-grid">
        {products.length === 0 ? <div className="card empty"><div className="icon">🛍️</div><h3>No products available</h3><p>The seller has not added any products yet.</p></div> : filteredProducts.length === 0 ? <div className="card empty"><div className="icon">🔎</div><h3>No matching products</h3><p>Try a broader product name, category, or material.</p></div> : filteredProducts.map((p) => (
          <ProductCard
            key={p.n}
            p={p}
            liked={wishlist.some((w) => w.n === p.n)}
            onWish={() => toggleWish(p)}
            onAdd={(product = p, comparedTo = null) => addToCart(product, comparedTo)}
            onExplain={() => onExplainProduct(p)}
            saferAlternative={getSaferAlternative(p, products)}
          />
        ))}
      </div>
    </section>
  );
}

function WishlistPage({ wishlist, toggleWish, addToCart }) {
  return (
    <section className="page">
      <div className="page-title">❤️ My Wishlist</div>
      <div className="page-sub">{wishlist.length} saved item{wishlist.length === 1 ? "" : "s"}</div>
      <div className="card">
        {wishlist.length === 0 ? (
          <div className="empty">
            <div className="icon" style={{ fontSize: 34 }}>🤍</div>
            <h3>Your wishlist is empty</h3>
            <p>Browse Products and tap the ❤️ heart button to save items here.</p>
          </div>
        ) : (
          <div className="prod-grid">
            {wishlist.map((p) => (
              <ProductCard key={p.n} p={p} liked onWish={() => toggleWish(p)} onAdd={() => addToCart(p)} showRemove />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function CartPage({ cart, changeQty, removeLine, clearCart, placeOrder, subtotal, discount, total, co2, orderMessage, goto }) {
  if (cart.length === 0) {
    return (
      <section className="page">
        <div className="page-title">🛒 Your Cart</div>
        <div className="card empty">
          <div className="icon">{orderMessage ? "✅" : "🛒"}</div>
          <h3>{orderMessage || "Your cart is empty"}</h3>
          {orderMessage ? (
            <>
              <p>Your order is saved in your account and has status <strong>Placed</strong>.</p>
              <button className="btn-mini" onClick={() => goto("profile")}>View Orders</button>
            </>
          ) : (
            <>
              <p>Add eco-friendly products to get started.</p>
              <button className="btn-mini" onClick={() => goto("products")}>Browse Products</button>
            </>
          )}
        </div>
      </section>
    );
  }
  const count = cart.reduce((a, c) => a + c.qty, 0);
  return (
    <section className="page">
      <div className="page-title" style={{ justifyContent: "space-between", display: "flex" }}>
        <span>🛒 Your Cart</span>
        <a style={{ color: "var(--red)", fontSize: 13, fontWeight: 600 }} onClick={clearCart}>Clear all</a>
      </div>
      <div className="page-sub">{count} item{count === 1 ? "" : "s"}</div>

      {cart.map((c, i) => (
        <div className="card" style={{ marginBottom: 12 }} key={c.n}>
          <div className="cart-line" style={{ border: "none", margin: 0, padding: 0 }}>
            <div className="thumb">{c.e}</div>
            <div><div className="name">{c.n}</div><div className="sub">{c.co2} kg CO₂ · {fmt(c.p)} each</div></div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
              <button className="icon-btn" onClick={() => changeQty(i, -1)}>−</button>
              <span>{c.qty}</span>
              <button className="icon-btn" onClick={() => changeQty(i, 1)}>+</button>
              <span className="price">{fmt(c.p * c.qty)}</span>
              <button className="icon-btn" onClick={() => removeLine(i)}>✕</button>
            </div>
          </div>
        </div>
      ))}

      <div className="card">
        <div className="card-head" style={{ color: "var(--green)" }}>ORDER SUMMARY</div>
        <div className="total-row"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
        <div className="total-row"><span style={{ color: "var(--green)" }}>🌿 Eco Discount (lower CO₂ items)</span><span style={{ color: "var(--green)" }}>− {fmt(discount)}</span></div>
        <div className="total-row"><span>Shipping</span><span>Free</span></div>
        <div className="total-row" style={{ fontWeight: 800, color: "var(--text)", fontSize: 15, borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 4 }}>
          <span>Total</span><span>{fmt(total)}</span>
        </div>
        <div className="card" style={{ background: "var(--panel2)", margin: "12px 0", padding: "12px 16px", display: "flex", gap: 10, alignItems: "center" }}>
          <span>🌍</span>
          <div>
            <div style={{ fontSize: 12.5, color: "var(--green)", fontWeight: 700 }}>Carbon Footprint</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>This order produces <b style={{ color: "var(--text)" }}>{co2} kg CO₂</b></div>
          </div>
        </div>
        <button className="btn-primary" onClick={placeOrder}>Place Order · {fmt(total)}</button>
      </div>
    </section>
  );
}

function AuthPage({ onAuthed }) {
  const [mode, setMode] = useState("login"); // "login" | "register" | "forgot"
  const [showLoginPass, setShowLoginPass] = useState(false);
  const [showRegPass, setShowRegPass] = useState(false);
  const [showRegConfirm, setShowRegConfirm] = useState(false);
  const [error, setError] = useState("");

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginRole, setLoginRole] = useState("user");

  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");
  const [regRole, setRegRole] = useState("user");
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const isLogin = mode === "login";

  const submitAuth = async (path, payload) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Authentication failed.");
      onAuthed(data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = () => {
    if (!loginEmail || !loginPassword) {
      setError("Please enter your email and password.");
      return;
    }
    submitAuth("/api/auth/signin", { email: loginEmail, password: loginPassword, role: loginRole });
  };

  const handleRegister = () => {
    if (!regName || !regEmail || !regPassword || !regConfirm) {
      setError("Please fill in all fields.");
      return;
    }
    if (regPassword !== regConfirm) {
      setError("Passwords do not match.");
      return;
    }
    if (regPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    submitAuth("/api/auth/signup", { name: regName, email: regEmail, password: regPassword, role: regRole });
  };

  const handleForgotPassword = () => {
    if (!forgotEmail) {
      setError("Please enter your email address.");
      return;
    }
    setError("");
    setResetSent(true);
  };

  const switchMode = (m) => {
    setError("");
    setResetSent(false);
    setMode(m);
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-left">
          <div className="brand" style={{ paddingBottom: 26 }}>
            <span className="logo">🌿</span>Eco<span className="eco">Choice</span>
          </div>

          {mode === "forgot" ? (
            <div>
              <div className="auth-title">Forgot Password?</div>
              {resetSent ? (
                <>
                  <p className="auth-sub">Check your inbox for a password reset link.</p>
                  <div className="reset-confirmation">
                    ✉️<strong>Reset link sent</strong>
                    <span>We sent instructions to {forgotEmail}.</span>
                  </div>
                  <button className="btn-primary" style={{ padding: 13 }} onClick={() => switchMode("login")}>Back to Sign In</button>
                </>
              ) : (
                <>
                  <p className="auth-sub">Enter your email and we'll send you a secure reset link.</p>
                  <div className="field">
                    <span className="fi">✉️</span>
                    <input type="email" placeholder="Email Address" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} />
                  </div>
                  {error && <div className="auth-error">{error}</div>}
                  <button className="btn-primary" style={{ padding: 13 }} onClick={handleForgotPassword}>Send Reset Link</button>
                  <div className="auth-switch"><a onClick={() => switchMode("login")}>← Back to Sign In</a></div>
                </>
              )}
            </div>
          ) : isLogin ? (
            <div>
              <div className="auth-title">Welcome Back</div>
              <p className="auth-sub">Sign in to your green journey</p>
              <div className="field">
                <span className="fi">🛡️</span>
                <select value={loginRole} onChange={(e) => setLoginRole(e.target.value)} aria-label="Sign in role">
                  <option value="user">Sign in as User</option>
                  <option value="admin">Sign in as Admin</option>
                </select>
              </div>
              <div className="field">
                <span className="fi">✉️</span>
                <input type="email" placeholder="Email Address" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} />
              </div>
              <div className="field">
                <span className="fi">🔒</span>
                <input type={showLoginPass ? "text" : "password"} placeholder="Password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} />
                <button type="button" className="toggle-eye" onClick={() => setShowLoginPass((s) => !s)}>👁</button>
              </div>
              <a className="auth-forgot" onClick={() => switchMode("forgot")}>Forgot Password?</a>
              {error && <div className="auth-error">{error}</div>}
              <button className="btn-primary" style={{ padding: 13 }} onClick={handleLogin} disabled={loading}>{loading ? "Signing In..." : "Sign In"}</button>
              <div className="auth-switch">New to EcoChoice? <a onClick={() => switchMode("register")}>Create an account</a></div>
            </div>
          ) : (
            <div>
              <div className="auth-title">Create Account</div>
              <p className="auth-sub">Join the green shopping movement</p>
              <div className="field">
                <span className="fi">🛡️</span>
                <select value={regRole} onChange={(e) => setRegRole(e.target.value)} aria-label="Account role">
                  <option value="user">Create User Account</option>
                  <option value="admin">Create Admin Account</option>
                </select>
              </div>
              <div className="field">
                <span className="fi">👤</span>
                <input type="text" placeholder="Full Name" value={regName} onChange={(e) => setRegName(e.target.value)} />
              </div>
              <div className="field">
                <span className="fi">✉️</span>
                <input type="email" placeholder="Email Address" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} />
              </div>
              <div className="field">
                <span className="fi">🔒</span>
                <input type={showRegPass ? "text" : "password"} placeholder="Password" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} />
                <button type="button" className="toggle-eye" onClick={() => setShowRegPass((s) => !s)}>👁</button>
              </div>
              <div className="field">
                <span className="fi">🔒</span>
                <input type={showRegConfirm ? "text" : "password"} placeholder="Confirm Password" value={regConfirm} onChange={(e) => setRegConfirm(e.target.value)} />
                <button type="button" className="toggle-eye" onClick={() => setShowRegConfirm((s) => !s)}>👁</button>
              </div>
              {error && <div className="auth-error">{error}</div>}
              <button className="btn-primary" style={{ padding: 13 }} onClick={handleRegister} disabled={loading}>{loading ? "Creating Account..." : "Create Account"}</button>
              <div className="auth-switch">Already have an account? <a onClick={() => switchMode("login")}>Sign in</a></div>
            </div>
          )}
        </div>

        <div className="auth-right">
          <div className="bagicon">🛍️</div>
          {mode === "forgot" ? (
            <>
              <h2>You're in safe hands</h2>
              <p>We'll help you get back to your sustainable shopping journey.</p>
            </>
          ) : isLogin ? (
            <>
              <h2>Hello, Green Shopper!</h2>
              <p>New here? Join EcoChoice and shop sustainably. Every purchase makes a difference.</p>
            </>
          ) : (
            <>
              <h2>Welcome Aboard!</h2>
              <p>Already growing your green cart? Sign back in and pick up where you left off.</p>
            </>
          )}
          <div className="auth-feat">🌐 10K+ Eco Products</div>
          <div className="auth-feat">🌱 Carbon Tracked</div>
          <div className="auth-feat">⭐ Verified Sellers</div>
          <button className="auth-register-btn" onClick={() => switchMode(mode === "forgot" ? "login" : isLogin ? "register" : "login")}>
            {mode === "forgot" ? "Sign In" : isLogin ? "Register" : "Sign In"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminPage({ user, onLogout }) {
  const [users, setUsers] = useState([]);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [activeSection, setActiveSection] = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [productMessage, setProductMessage] = useState("");
  const [productForm, setProductForm] = useState({ id: "", name: "", price: "", grade: "A", co2: "", category: "", material: "", productWeight: "", packagingType: "", image: null });

  const loadUsers = async () => {
    setLoading(true);
    setError("");
    try {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      const response = await fetch(`${API_BASE}/api/admin/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load users.");
      setUsers(data.users);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const loadProducts = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/products`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load products.");
      setProducts(data.map(toProduct));
    } catch (requestError) {
      setProductMessage(requestError.message);
    }
  };

  const loadOrders = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/admin/orders`, { headers: authHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load orders.");
      setOrders(data.orders || []);
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const updateProductField = (event) => {
    const { name, value } = event.target;
    setProductForm((current) => ({ ...current, [name]: value }));
  };

  const updateProductImage = (event) => {
    setProductForm((current) => ({ ...current, image: event.target.files?.[0] || null }));
  };

  const resetProductForm = () => {
    setProductForm({ id: "", name: "", price: "", grade: "A", co2: "", category: "", material: "", productWeight: "", packagingType: "", image: null });
  };

  const saveProduct = async (event) => {
    event.preventDefault();
    setProductMessage("");
    try {
      const scoreResponse = await fetch(`${API_BASE}/api/products/predict-co2`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          category: productForm.category,
          material: productForm.material,
          productWeight: productForm.productWeight,
          packagingType: productForm.packagingType,
        }),
      });
      const score = await readApiResponse(scoreResponse);
      if (!scoreResponse.ok) throw new Error(score.error || "Could not calculate the product sustainability score.");

      const payload = new FormData();
      payload.append("name", productForm.name);
      payload.append("price", productForm.price);
      payload.append("grade", score.grade);
      payload.append("co2", score.estimatedCo2);
      payload.append("category", productForm.category);
      payload.append("material", productForm.material);
      payload.append("productWeight", productForm.productWeight);
      payload.append("packagingType", productForm.packagingType);
      if (productForm.image) payload.append("image", productForm.image);
      const response = await fetch(
        `${API_BASE}/api/products${productForm.id ? `/${productForm.id}` : ""}`,
        {
          method: productForm.id ? "PATCH" : "POST",
          headers: authOnlyHeaders(),
          body: payload,
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save product.");
      setProductMessage(`${productForm.id ? "Product updated" : "Product added"}. AI score: ${score.estimatedCo2} kg CO₂, grade ${score.grade} (${Math.round(score.confidence * 100)}% model agreement).`);
      resetProductForm();
      await loadProducts();
    } catch (requestError) {
      setProductMessage(requestError.message);
    }
  };

  const editProduct = (product) => {
    setProductForm({ id: product.id, name: product.n, price: product.p, grade: product.g, co2: product.co2, category: product.category, material: product.material, productWeight: product.productWeight, packagingType: product.packagingType, image: null });
    setProductMessage("");
    window.scrollTo(0, 0);
  };

  const deleteProduct = async (product) => {
    if (!window.confirm(`Remove ${product.n} from the catalog?`)) return;
    try {
      const response = await fetch(`${API_BASE}/api/products/${product.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not remove product.");
      setProducts((current) => current.filter((item) => item.id !== product.id));
      if (productForm.id === product.id) resetProductForm();
      setProductMessage("Product removed from the catalog.");
    } catch (requestError) {
      setProductMessage(requestError.message);
    }
  };

  useEffect(() => {
    loadUsers();
    loadProducts();
    loadOrders();
  }, []);

  const adminCount = users.filter((account) => account.role === "admin").length;

  return (
    <div className="admin-shell">
      <aside className={"sidebar admin-sidebar" + (sidebarOpen ? " open" : "")}>
        <div className="brand"><span className="logo">🌿</span>Eco<span className="eco">Choice</span></div>
        <nav className="nav" aria-label="Admin navigation">
          {[['overview', '📊 Overview'], ['products', '🛍️ Products'], ['orders', '📦 Orders'], ['users', '👥 Users']].map(([section, label]) => (
            <a className={"nav-item" + (activeSection === section ? " active" : "")} key={section} onClick={() => { setActiveSection(section); setSidebarOpen(false); }}>{label}</a>
          ))}
        </nav>
        <a className="logout" onClick={onLogout}>↩ Logout</a>
      </aside>
      <main className="admin-main">
        <div className="topbar"><div className="crumb"><button className="menu-btn" onClick={() => setSidebarOpen((open) => !open)}>☰</button>🛡️ ECOCHOICE &nbsp;·&nbsp; <b>ADMIN</b></div><span className="admin-signed-in">Signed in as {user.name}</span></div>
        <div className="page-title">🛡️ Admin Dashboard</div>
        <p className="page-sub">Manage EcoChoice accounts and platform access.</p>
        <div className="stats admin-stats">
          <div className="card"><div className="stat-label">TOTAL ACCOUNTS</div><div className="stat-num">{users.length}</div><div className="stat-sub">registered accounts</div></div>
          <div className="card"><div className="stat-label">USER ACCOUNTS</div><div className="stat-num">{users.length - adminCount}</div><div className="stat-sub">shopping members</div></div>
          <div className="card"><div className="stat-label">ADMIN ACCOUNTS</div><div className="stat-num">{adminCount}</div><div className="stat-sub">platform managers</div></div>
          <div className="card"><div className="stat-label">ORDERS PLACED</div><div className="stat-num">{orders.length}</div><div className="stat-sub">customer orders</div></div>
        </div>
        {activeSection === "users" && <div className="card admin-users-card">
          <div className="card-head"><span>ACCOUNT DIRECTORY</span><button className="btn-mini" onClick={loadUsers}>Refresh</button></div>
          {loading && <div className="admin-empty">Loading accounts...</div>}
          {error && <div className="form-error">{error}</div>}
          {!loading && !error && users.map((account) => (
            <div className="admin-user-row" key={account.id}>
              <div className="avatar small-avatar">{account.name.slice(0, 2).toUpperCase()}</div>
              <div className="admin-user-main"><strong>{account.name}</strong><span>{account.email}</span></div>
              <span className="role-tag">{account.role}</span>
            </div>
          ))}
          {!loading && !error && users.length === 0 && <div className="admin-empty">No accounts found.</div>}
        </div>}
        {activeSection === "products" && <div className="card admin-products-card">
          <div className="card-head"><span>{productForm.id ? "EDIT PRODUCT" : "ADD PRODUCT"}</span>{productForm.id && <button className="btn-mini" onClick={resetProductForm}>Cancel Edit</button>}</div>
          <form className="product-form" onSubmit={saveProduct}>
            <label>Product Name<input name="name" value={productForm.name} onChange={updateProductField} placeholder="e.g. Organic Cotton Tote Bag" required /></label>
            <label>Price (₹)<input name="price" type="number" min="0" step="0.01" value={productForm.price} onChange={updateProductField} required /></label>
            <label>Product Category<select name="category" value={productForm.category} onChange={updateProductField} required><option value="">Choose a category</option>{PRODUCT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
            <label>Material<select name="material" value={productForm.material} onChange={updateProductField} required><option value="">Choose a material</option>{PRODUCT_MATERIALS.map((material) => <option key={material}>{material}</option>)}</select></label>
            <label>Product Weight (g)<input name="productWeight" type="number" min="0" step="0.1" value={productForm.productWeight} onChange={updateProductField} required /></label>
            <label>Packaging Type<select name="packagingType" value={productForm.packagingType} onChange={updateProductField} required><option value="">Choose packaging</option>{PRODUCT_PACKAGING.map((packaging) => <option key={packaging}>{packaging}</option>)}</select></label>
            <label>Product Image (max 150 KB)<input type="file" accept="image/*" onChange={updateProductImage} /></label>
            {productMessage && <div className="form-message">{productMessage}</div>}
            <button className="btn-primary" type="submit">{productForm.id ? "Update Product" : "Add Product"}</button>
          </form>
          <div className="card-head" style={{ marginTop: 24 }}><span>CATALOG ({products.length})</span><button className="btn-mini" onClick={loadProducts}>Refresh</button></div>
          {products.length === 0 ? <div className="admin-empty">No products in the catalog yet.</div> : products.map((product) => (
            <div className="admin-product-row" key={product.id}>
              <div className="thumb">{product.image ? <img className="product-image" src={product.image} alt="" /> : product.e}</div>
              <div className="admin-user-main"><strong>{product.n}</strong><span>{fmt(product.p)} · {product.category || "Uncategorized"} · {product.material || "Material not set"} · {product.productWeight || "-"} g</span></div>
              <button className="btn-mini" onClick={() => editProduct(product)}>Edit</button>
              <button className="btn-mini danger" onClick={() => deleteProduct(product)}>Delete</button>
            </div>
          ))}
        </div>}
        {activeSection === "orders" && <div className="card admin-orders-card">
          <div className="card-head"><span>ALL CUSTOMER ORDERS</span><button className="btn-mini" onClick={loadOrders}>Refresh</button></div>
          {error && <div className="form-error">{error}</div>}
          {orders.length === 0 ? <div className="admin-empty">No customer orders yet.</div> : orders.map((order) => (
            <div className="admin-order-row" key={order._id || order.orderNumber}>
              <div className="order-icon">📦</div>
              <div className="admin-user-main">
                <strong>#{order.orderNumber} · {order.customer.name}</strong>
                <span>{order.customer.email} · {(order.items || []).map((item) => `${item.n} × ${item.qty}`).join(", ")}</span>
              </div>
              <div className="order-summary"><b>{fmt(order.total)}</b><span className="order-status placed">{order.status || "Placed"}</span><small>{new Date(order.createdAt).toLocaleDateString("en-IN")}</small></div>
            </div>
          ))}
        </div>}
      </main>
    </div>
  );
}

function ProfilePage({ user, orders, onUserUpdated }) {
  const [activeTab, setActiveTab] = useState("profile");
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone || "");
  const [infoMessage, setInfoMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const saveInfo = async (event) => {
    event.preventDefault();
    setInfoMessage("");
    try {
      const response = await fetch(`${API_BASE}/api/auth/profile`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}`,
        },
        body: JSON.stringify({ name, email, phone }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update your profile.");
      onUserUpdated(data.user);
      setInfoMessage("Your profile information has been updated.");
    } catch (requestError) {
      setInfoMessage(requestError.message);
    }
  };

  const updatePassword = async (event) => {
    event.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordMessage("Please complete all password fields.");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordMessage("Your new password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage("New passwords do not match.");
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/api/auth/password`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update your password.");
      setPasswordMessage("Your password has been updated successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (requestError) {
      setPasswordMessage(requestError.message);
    }
  };

  const tabs = [
    ["profile", "Profile"],
    ["edit", "Edit Info"],
    ["password", "Password"],
    ["orders", "Orders"],
  ];

  return (
    <section className="page">
      <div className="card">
        <div className="profile-head">
          <div className="avatar">{getInitials(name)}</div>
          <div>
            <h1>{name}</h1>
            <div className="email">{email}</div>
            <span className="role-tag">🌿 {user.role}</span>
          </div>
        </div>
      </div>
      <div style={{ height: 16 }} />
      <div className="tabs">
        {tabs.map(([id, label]) => (
          <button className={"tab" + (activeTab === id ? " active" : "")} key={id} onClick={() => setActiveTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {activeTab === "profile" && (
        <>
          <div className="card">
            <div className="card-head">ACCOUNT DETAILS</div>
            <div className="detail-row"><div className="di">👤</div><div><div className="lbl">Full Name</div><div className="val">{name}</div></div></div>
            <div className="detail-row"><div className="di">✉️</div><div><div className="lbl">Email Address</div><div className="val">{email}</div></div></div>
            <div className="detail-row"><div className="di">📱</div><div><div className="lbl">Phone Number</div><div className="val">{phone}</div></div></div>
            <div className="detail-row"><div className="di">🔑</div><div><div className="lbl">Role</div><div className="val">User</div></div></div>
          </div>
          <div className="card champion">
            <span style={{ fontSize: 26 }}>🏆</span>
            <div><h4>Eco Champion</h4><p>You're among the top 15% of eco-conscious shoppers</p></div>
          </div>
        </>
      )}
      {activeTab === "edit" && (
        <form className="card profile-form" onSubmit={saveInfo}>
          <div className="card-head">EDIT PERSONAL INFORMATION</div>
          <label>Full Name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>Email Address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Phone Number<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
          {infoMessage && <div className="form-message">✅ {infoMessage}</div>}
          <button className="btn-primary" type="submit">Save Changes</button>
        </form>
      )}
      {activeTab === "password" && (
        <form className="card profile-form" onSubmit={updatePassword}>
          <div className="card-head">CHANGE PASSWORD</div>
          <p className="form-help">Choose a strong password with at least 6 characters.</p>
          <label>Current Password<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
          <label>New Password<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
          <label>Confirm New Password<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
          {passwordMessage && <div className={passwordMessage.includes("successfully") ? "form-message" : "form-error"}>{passwordMessage}</div>}
          <button className="btn-primary" type="submit">Update Password</button>
        </form>
      )}
      {activeTab === "orders" && (
        <div className="card">
          <div className="card-head"><span>ORDER HISTORY</span><span className="order-count">{orders.length} order{orders.length === 1 ? "" : "s"}</span></div>
          {orders.length === 0 ? (
            <div className="empty"><div className="icon">📦</div><h3>No orders yet</h3><p>Your completed orders will appear here.</p></div>
          ) : orders.map((order) => (
            <div className="order-row" key={order._id || order.orderNumber}>
              <div className="order-icon">📦</div>
              <div className="order-main">
                <strong>#{order.orderNumber}</strong>
                <span>{order.items.map((item) => `${item.n} × ${item.qty}`).join(", ")} · {new Date(order.createdAt).toLocaleDateString("en-IN")}</span>
              </div>
              <div className="order-summary"><b>{fmt(order.total)}</b><span className={"order-status " + String(order.status || "Placed").toLowerCase()}>{order.status || "Placed"}</span></div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
