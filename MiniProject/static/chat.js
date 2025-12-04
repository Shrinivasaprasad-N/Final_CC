// chat.js — Handles real-time chat between farmer & winning bidder

const chatBox = document.getElementById("chat-box");
const messageInput = document.getElementById("message");
const backBtn = document.getElementById("backBtn"); // Add if back button exists in markup

const currentUser = JSON.parse(localStorage.getItem("loggedInUser")) || {};
const cropId = new URLSearchParams(window.location.search).get("crop_id");

let receiverId = null;

// Validate login and cropId presence
if (!currentUser?.id) {
  alert("Please login to access chat.");
  window.location.href = "/login";
}

if (!cropId) {
  alert("Invalid or missing crop ID.");
  window.history.back();
}

// Step 1: Fetch crop to determine receiver
async function loadCropInfo() {
  try {
    const res = await fetch(`/api/get_crop/${cropId}`);
    if (!res.ok) throw new Error("Failed to fetch crop info");

    const crop = await res.json();

    if (!crop || !crop.farmer_id) {
      alert("Invalid crop data.");
      return false;
    }

    if (currentUser.id === crop.farmer_id) {
      // Farmer → receiver is winning bidder
      receiverId = crop.highest_bidder;
    } else {
      // Bidder → receiver is farmer
      receiverId = crop.farmer_id;
    }

    if (!receiverId) {
      alert("Chat partner not found.");
      return false;
    }

    return true;
  } catch (err) {
    console.error("Error loading crop info:", err);
    alert("Error loading crop information.");
    return false;
  }
}

// Load messages periodically
async function loadMessages() {
  try {
    if (!receiverId) return;

    const res = await fetch(`/api/messages/${cropId}`);
    if (!res.ok) throw new Error("Failed to load messages");

    const data = await res.json();
    renderMessages(data);
  } catch (err) {
    console.error("Error loading messages:", err);
  }
}

// Render chat messages
function renderMessages(messages) {
  chatBox.innerHTML = "";

  if (!messages || messages.length === 0) {
    chatBox.innerHTML = "<p style='text-align:center;color:gray;'>No messages yet...</p>";
    return;
  }

  messages.forEach(msg => {
    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${msg.sender_id === currentUser.id ? "self" : "other"}`;
    msgDiv.innerHTML = `
      <div>${msg.message}</div>
      <div class="timestamp">${new Date(msg.timestamp).toLocaleTimeString()}</div>
    `;
    chatBox.appendChild(msgDiv);
  });

  chatBox.scrollTop = chatBox.scrollHeight;
}

async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;

  if (!receiverId) {
    alert("Receiver not found.");
    return;
  }

  try {
    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        crop_id: cropId,
        sender_id: currentUser.id,
        receiver_id: receiverId,
        message: text
      })
    });

    if (!res.ok) throw new Error("Failed to send message");

    messageInput.value = "";
    await loadMessages();
  } catch (err) {
    alert("Error sending message: " + err.message);
  }
}

function goBack() {
  window.history.back();
}

// Attach event listeners
sendBtn = document.getElementById("sendBtn");
if (sendBtn) {
  sendBtn.addEventListener("click", sendMessage);
}
messageInput.addEventListener("keypress", e => {
  if (e.key === "Enter") sendMessage();
});
if (backBtn) {
  backBtn.addEventListener("click", goBack);
}

// Initialize chat
(async function initChat() {
  const cropLoaded = await loadCropInfo();
  if (!cropLoaded) return;

  await loadMessages();
  setInterval(loadMessages, 2000);
})();
