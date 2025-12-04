// -------------------- FETCH CURRENT USER --------------------
const currentUser = JSON.parse(localStorage.getItem("loggedInUser")) || { email: "guest@example.com" };

// -------------------- FETCH SELECTED CROP --------------------
let currentCrop = JSON.parse(localStorage.getItem("currentBidCrop"));
if (!currentCrop) {
    alert("No crop selected for bidding!");
    window.location.href = "/bidderportal"; // redirect back
}

// -------------------- ELEMENTS --------------------
const cropNameEl = document.getElementById("cropName");
const cropQuantityEl = document.getElementById("cropQuantity");
const cropQualityEl = document.getElementById("cropQuality");
const basePriceEl = document.getElementById("basePrice");
const currentPriceEl = document.getElementById("currentPrice");
const cropImageEl = document.getElementById("cropImage");
const timerEl = document.getElementById("timer");
const bidInput = document.getElementById("bidInput");
const placeBidBtn = document.getElementById("placeBidBtn");

// -------------------- INITIAL PRICE --------------------
let cropId = currentCrop._id || currentCrop.id;
let currentPrice = currentCrop.price || 0;

// Display crop info
if (cropNameEl) cropNameEl.innerText = currentCrop.name || "-";
if (cropQuantityEl) cropQuantityEl.innerText = currentCrop.quantity ?? "-";
if (cropQualityEl) cropQualityEl.innerText = currentCrop.quality ?? "-";
if (basePriceEl) basePriceEl.innerText = currentCrop.price ?? 0;
if (currentPriceEl) currentPriceEl.innerText = currentPrice;
if (cropImageEl) cropImageEl.src = currentCrop.image || "/static/default_crop.jpg";

// -------------------- TIMER --------------------
let endTime = new Date(new Date(currentCrop.datetime).getTime() + 5 * 60 * 1000);

function disableBidding() {
    if (bidInput) bidInput.disabled = true;
    if (placeBidBtn) placeBidBtn.disabled = true;
}

async function finalizeAuction() {
    disableBidding();
    try {
        const res = await fetch(`/api/auction/winner/${encodeURIComponent(cropId)}`, { credentials: "include" });
        const data = await res.json();
        if (!res.ok) {
            alert(`Auction ended, failed to fetch winner: ${data.error || "Unknown error"}`);
            return;
        }

        const winnerUserId = data.user_id;
        const winnerEmail = data.bidder_email || "Unknown";
        const bidPrice = data.bid_price ?? currentPrice;

        if (String(winnerUserId) === String(currentUser.id || currentUser._id)) {
            // Save won crop to server
            await fetch("/api/save_won_crop", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    user_id: currentUser.id || currentUser._id,
                    crop_id: cropId,
                    farmer_id: currentCrop.farmer_id || currentCrop.farmer,
                    bid_price: bidPrice
                })
            });
            alert(`🎉 You won "${currentCrop.name}" at ₹${bidPrice}`);
        } else {
            alert(`Auction ended. Winner: ${winnerEmail} at ₹${bidPrice}`);
        }
    } catch (err) {
        console.error("Finalize auction failed:", err);
        alert("Auction ended, unable to determine winner.");
    }
}

function updateTimer() {
    const now = new Date();
    const diff = endTime - now;

    if (diff <= 0) {
        clearInterval(timerInterval);
        timerEl.innerText = "Bidding Closed";
        finalizeAuction();
        return;
    }

    const mins = Math.floor(diff / (1000 * 60));
    const secs = Math.floor((diff % (1000 * 60)) / 1000);
    timerEl.innerText = `Time Left: ${mins}m ${secs}s`;

    // Optionally: fetch live current bid from server
    fetch(`/api/current_bid/${cropId}`, { credentials: "include" })
        .then(res => res.json())
        .then(data => {
            if (data.bid_price && data.bid_price > currentPrice) {
                currentPrice = data.bid_price;
                if (currentPriceEl) currentPriceEl.innerText = currentPrice;
            }
        })
        .catch(err => console.warn("Live bid fetch failed:", err));
}

let timerInterval = setInterval(updateTimer, 1000);
updateTimer();

// -------------------- PLACE BID --------------------
placeBidBtn.addEventListener("click", async () => {
    const bidValue = parseFloat(bidInput.value);
    if (!bidValue || bidValue <= currentPrice) {
        alert(`Your bid must be higher than current price ₹${currentPrice}`);
        return;
    }

    const bidderId = currentUser.id || currentUser._id;
    if (!bidderId || !currentUser.email) {
        alert("Login required to place bid");
        return;
    }

    try {
        const res = await fetch("/api/place_bid", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
                crop_id: cropId,
                bidder_id: bidderId,
                bidder_email: currentUser.email,
                bid_price: bidValue
            })
        });

        const data = await res.json();
        if (!res.ok) {
            alert(`Server bid failed: ${data.error || "Unknown error"}`);
            return;
        }

        currentPrice = bidValue;
        if (currentPriceEl) currentPriceEl.innerText = currentPrice;
        alert(`✅ Bid placed successfully at ₹${currentPrice}`);
    } catch (err) {
        console.error("Bid failed:", err);
        alert("Failed to place bid. Try again.");
    }
});
