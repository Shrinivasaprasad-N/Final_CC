// 🌾 b_portal.js — Full featured with live bid updates & server integration

// -------------------- GLOBAL VARIABLES --------------------
let crops = [];
let wishlist = [];
let wonCrops = [];
let currentUser = {};
let cropsContainer = null;
let wonContainer = null;
let noCropsMessage = null;
let wishlistCountEl = null;
let searchInput = null;
let filterBtn = null;
let locationInput = null;
const countdownIntervals = {}; // track timers by crop id

// -------------------- UTILITIES --------------------
function getIdOf(x) { return x?._id || x?.id || x?.crop_id || ""; }
function getName(x) { return x?.name || x?.crop_name || "Unnamed"; }
function getFarmer(x) { return x?.farmer_name || x?.farmer || x?.uploaded_by_name || "Farmer"; }
function getImage(x) { return x?.image || (x?.images && x.images[0]) || "/static/default_crop.jpg"; }
function formatDT(dt) { try { return new Date(dt).toLocaleString(); } catch { return dt || "-"; } }
function auctionEndTs(item) { const t = new Date(item.datetime).getTime(); return isNaN(t) ? null : t + 5*60*1000; }
function isAuctionOpen(item) { const end = auctionEndTs(item); return end===null ? true : Date.now()<end; }
function safeJSONParse(s,fallback=null){try{return JSON.parse(s);}catch{return fallback;}}

// -------------------- CURRENT USER & LOCAL WISHLIST --------------------
function loadSessionData(){
    try { currentUser = JSON.parse(localStorage.getItem("loggedInUser")) || {}; } catch { currentUser = {}; }
    try { wishlist = JSON.parse(localStorage.getItem("wishlist")) || []; } catch { wishlist = []; }
}
function saveWishlist(){ localStorage.setItem("wishlist",JSON.stringify(wishlist)); updateWishlistCount(); }
function updateWishlistCount(){ if(wishlistCountEl) wishlistCountEl.textContent = wishlist.length; }

// -------------------- FETCH CROPS & WON CROPS --------------------
async function fetchCrops(){
    try{
        const res = await fetch("/api/crops");
        const data = await res.ok ? await res.json() : [];
        crops = Array.isArray(data) ? data.map(c => ({ ...c, _id: getIdOf(c) })) : [];
        displayCrops(crops.filter(c=>{
            const status = (c.status||"").toLowerCase();
            const end = auctionEndTs(c);
            return !(status==="closed"||status==="sold"||(end && Date.now()>=end));
        }));
    } catch(e){ console.error("fetchCrops error:",e); if(cropsContainer)cropsContainer.innerHTML=`<p style="color:red;">Error loading crops.</p>`; }
}

async function fetchWonCrops(){
    try{
        const res = await fetch("/api/won-crops",{credentials:'include'});
        if(!res.ok){ wonCrops=[]; renderWonCrops(); return; }
        const data = await res.json();
        wonCrops = Array.isArray(data)? data : [];
        renderWonCrops();
    } catch(e){ console.error("fetchWonCrops error:",e); wonCrops=[]; renderWonCrops(); }
}

// -------------------- DISPLAY CROPS --------------------
function displayCrops(list){
    if(!cropsContainer) return;
    cropsContainer.innerHTML="";
    if(!Array.isArray(list)||list.length===0){
        if(noCropsMessage) noCropsMessage.style.display="block";
        cropsContainer.innerHTML=`<p>No crops available for bidding.</p>`;
        return;
    }
    if(noCropsMessage) noCropsMessage.style.display="none";

    list.forEach(item=>{
        const id = getIdOf(item);
        const inWishlist = wishlist.some(w=>getIdOf(w)===id);
        const showChatButton = item.highest_bidder && currentUser.email && String(item.highest_bidder)===String(currentUser.email);

        const card = document.createElement("div");
        card.className="crop-card";
        card.innerHTML=`
          <img src="${getImage(item)}" alt="${getName(item)}" class="crop-img"/>
          <div class="crop-info">
            <h3 class="crop-title">${getName(item)}</h3>
            <p>Price: ₹<span class="price">${item.price??0}</span></p>
            <p>Quantity: ${item.quantity??"-"} kg</p>
            <p>Farmer: ${getFarmer(item)}</p>
            <p>Location: ${item.location||"N/A"}</p>
            <p><span id="timer-${id}" class="timer">⏳ Loading...</span></p>
            <div class="btn-row">
              <button class="wishlist-btn" data-id="${id}">${inWishlist?"❤️ Remove":"🤍 Wishlist"}</button>
              <button class="bid-btn" data-id="${id}">💰 Place Bid</button>
              ${showChatButton?`<button class="chat-btn" data-id="${id}">💬 Chat</button>`:""}
            </div>
          </div>
        `;

        card.addEventListener("click",e=>{if(e.target.tagName==="BUTTON") return; showDetails(id);});

        // Wishlist toggle
        card.querySelector(".wishlist-btn").addEventListener("click",e=>{
            e.stopPropagation();
            toggleWishlist(item);
            e.currentTarget.textContent=wishlist.some(w=>getIdOf(w)===id)?"❤️ Remove":"🤍 Wishlist";
        });

        // Bid button → redirect to bid_portal
        card.querySelector(".bid-btn").addEventListener("click",e=>{
            e.stopPropagation();
            localStorage.setItem("currentBidCrop",JSON.stringify(item));
            window.location.href="/bid_portal";
        });

        // Chat button
        if(showChatButton){
            card.querySelector(".chat-btn").addEventListener("click",e=>{
                e.stopPropagation(); openChat(id);
            });
        }

        cropsContainer.appendChild(card);
        startCountdownFor(item);
    });

    updateWishlistCount();
}

// -------------------- UTILITIES --------------------
function getFarmer(x) {
    // Try multiple fields, fallback to 'Unknown Farmer'
    return x?.farmer || x?.farmer_name || x?.uploaded_by_name || "Unknown Farmer";
}

// -------------------- DISPLAY WON CROPS IN CARD STYLE --------------------
// -------------------- DISPLAY WON CROPS IN CARD STYLE --------------------
function renderWonCrops() {
    if (!wonContainer) return;
    wonContainer.innerHTML = "";

    if (!wonCrops || wonCrops.length === 0) {
        wonContainer.innerHTML = `<div class="no-won-crops">
            <h3>No Won Bids Yet</h3>
            <p>When you win a bidding, your crop will appear here 🎉</p>
        </div>`;
        return;
    }

    wonCrops.forEach(entry => {
        const crop = entry.crop || {};
        const cropName = getName(crop);
        const img = getImage(crop);
        const price = entry.bid_price ?? 0;
        const quantity = crop.quantity ?? 0;
        const quality = crop.quality ?? "-";
        const totalPrice = price * quantity;
        const id = getIdOf(crop);

        // Card container
        const card = document.createElement("div");
        card.className = "won-bid-card";
        card.style = `
            display: flex;
            align-items: center;
            gap: 15px;
            padding: 12px;
            margin-bottom: 12px;
            border: 1px solid #ddd;
            border-radius: 8px;
            background-color: #f9f9f9;
            box-shadow: 0 2px 6px rgba(0,0,0,0.1);
        `;

        // Image box
        const imgBox = document.createElement("div");
        imgBox.style = "flex-shrink: 0;";
        imgBox.innerHTML = `<img src="${img}" alt="${cropName}" style="width: 100px; height: 100px; object-fit: cover; border-radius: 6px;">`;

        // Info box
        const infoBox = document.createElement("div");
        infoBox.style = "flex-grow: 1;";
        infoBox.innerHTML = `
            <h3 style="margin: 0 0 6px 0; font-size: 18px;">${cropName}</h3>
            <p style="margin: 2px 0;">Farmer: ${getFarmer(crop)}</p>
            <p style="margin: 2px 0;">Quantity: ${quantity} kg</p>
            <p style="margin: 2px 0;">Quality: ${quality}</p>
            <p style="margin: 2px 0;"><strong>Winning Bid: ₹${price}</strong></p>
            <p style="margin: 2px 0;"><strong>Total Price: ₹${totalPrice}</strong></p>
            <p style="margin: 4px 0; color: green;">🎉 You Won This Bid!</p>
            <div style="display: flex; gap: 10px; margin-top: 6px;">
                <button class="chat-won-btn" data-id="${id}" style="padding: 6px 10px; border-radius: 4px; border: none; background-color: #4CAF50; color: white; cursor: pointer;">💬 Chat</button>
                <button class="view-details" data-id="${id}" style="padding: 6px 10px; border-radius: 4px; border: none; background-color: #2196F3; color: white; cursor: pointer;">🔍 View Details</button>
                <button class="delete-won-btn" data-id="${id}" style="padding: 6px 10px; border-radius: 4px; border: none; background-color: #f44336; color: white; cursor: pointer;">🗑️ Delete</button>
            </div>
        `;

        card.appendChild(imgBox);
        card.appendChild(infoBox);
        wonContainer.appendChild(card);
    });

    // Chat button
    wonContainer.querySelectorAll(".chat-won-btn").forEach(btn => {
        btn.addEventListener("click", e => {
            const id = e.currentTarget.dataset.id;
            openChat(id);
        });
    });

    // View Details popup
    wonContainer.querySelectorAll(".view-details").forEach(btn => {
        btn.addEventListener("click", e => {
            const id = e.currentTarget.dataset.id;
            const entry = wonCrops.find(wc => getIdOf(wc.crop) === id);
            if (!entry) return;
            const crop = entry.crop;

            const popup = document.getElementById("detailsPopup");
            const overlay = document.getElementById("popupOverlay");
            if (!popup || !overlay) return;

            const bidPrice = entry.bid_price ?? 0;
            const quantity = crop.quantity ?? 0;
            const totalPrice = bidPrice * quantity;

            document.getElementById("cropName").innerText = getName(crop);
            document.getElementById("cropFarmer").innerText = getFarmer(crop);
            document.getElementById("cropQuantity").innerText = quantity;
            document.getElementById("cropQuality").innerText = crop.quality ?? "-";
            document.getElementById("cropLocation").innerText = crop.location || "Unknown";
            document.getElementById("cropTime").innerText = formatDT(crop.datetime || crop.time);
            document.getElementById("biddingStatus").innerHTML = "<span style='color:green;'>🎉 You Won This Bid!</span>";
            document.getElementById("bidPrice").innerText = `Bid Price: ₹${bidPrice}`;
            document.getElementById("totalPrice").innerText = `Total Price: ₹${totalPrice}`;

            // Image gallery
            const gallery = document.getElementById("popupImageGallery");
            gallery.innerHTML = "";
            const imgs = crop.images?.length ? crop.images : (crop.image ? [crop.image] : []);
            if (!imgs.length) gallery.innerHTML = "<p>No images available.</p>";
            else imgs.forEach(src => {
                const i = document.createElement("img");
                i.src = src;
                i.style.width = "80px";
                i.style.borderRadius = "4px";
                i.style.marginRight = "6px";
                gallery.appendChild(i);
            });

            popup.style.display = "block";
            overlay.style.display = "block";
        });
    });

    // Delete won crop button
 wonContainer.querySelectorAll(".delete-won-btn").forEach(btn => {
    btn.addEventListener("click", async e => {
        e.stopPropagation();
        const id = e.currentTarget.dataset.id;
        if (!confirm("Are you sure you want to delete this won crop?")) return;

        try {
            // Call backend API to delete using query param for user_id
            const userId = currentUser.id || currentUser._id;
            const res = await fetch(`/api/delete_won_bid/${id}?user_id=${userId}`, {
                method: "DELETE",
                credentials: "include"
            });

            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || "Delete failed");

            // Remove from frontend array and re-render
            wonCrops = wonCrops.filter(wc => getIdOf(wc.crop) !== id);
            renderWonCrops();
        } catch (err) {
            console.error("Delete won crop failed", err);
            alert("❌ Failed to delete won crop.");
        }
    });
});
}


// -------------------- COUNTDOWN & LIVE BID --------------------
function startCountdownFor(item){
    const id=getIdOf(item);
    const el=document.getElementById(`timer-${id}`);
    if(!el) return;

    if(countdownIntervals[id]) { clearInterval(countdownIntervals[id]); delete countdownIntervals[id]; }

    const start=new Date(item.datetime).getTime();
    const end=start+5*60*1000;

    async function tick(){
        const now=Date.now();
        if(now<start){
            const diff=start-now;
            const m=Math.floor(diff/60000);
            const s=Math.floor((diff%60000)/1000);
            el.innerText=`⏳ Starts in: ${m}m ${s}s`;
        } else if(now>=start && now<end){
            const diff=end-now;
            const m=Math.floor(diff/60000);
            const s=Math.floor((diff%60000)/1000);
            el.innerText=`⏰ Time Left: ${m}m ${s}s`;

            // Live current bid
            fetch(`/api/current_bid/${id}`,{credentials:'include'})
                .then(r=>r.json())
                .then(data=>{
                    if(data.bid_price && data.bid_price>item.price){
                        item.price=data.bid_price;
                        el.previousElementSibling.querySelector(".price").innerText=data.bid_price;
                    }
                })
                .catch(err=>console.warn("Live bid fetch failed:",err));
        } else {
            el.innerText="🔒 Bidding Closed";
            clearInterval(countdownIntervals[id]);
            delete countdownIntervals[id];
            await finalizeAuction(item);
        }
    }

    tick();
    countdownIntervals[id]=setInterval(tick,1000);
}

async function finalizeAuction(item){
    try{
        const res=await fetch(`/api/auction/winner/${item._id}`,{credentials:'include'});
        if(res.ok){
            const winnerData=await res.json();
            // If current user won → save
            if(String(winnerData.user_id)===String(currentUser.id||currentUser._id)){
                await fetch("/api/save_won_crop",{
                    method:"POST",
                    headers:{"Content-Type":"application/json"},
                    credentials:'include',
                    body:JSON.stringify({ user_id:currentUser.id||currentUser._id, crop_id:item._id, farmer_id:item.farmer_id||item.farmer, bid_price:winnerData.bid_price??item.price })
                });
                alert(`🎉 You won "${getName(item)}" at ₹${winnerData.bid_price}`);
            }
        }
        fetchCrops();
        fetchWonCrops();
    } catch(e){ console.error("Finalize auction failed",e); }
}

// -------------------- WISHLIST --------------------
function toggleWishlist(item){
    const id=getIdOf(item);
    const idx=wishlist.findIndex(w=>getIdOf(w)===id);
    if(idx>=0) wishlist.splice(idx,1); else wishlist.push(item);
    saveWishlist();
}

// -------------------- DETAILS POPUP --------------------
function showDetails(id){
    const crop=crops.find(c=>getIdOf(c)===id);
    if(!crop) return;
    const popup=document.getElementById("detailsPopup");
    const overlay=document.getElementById("popupOverlay");
    if(!popup||!overlay) return;

    document.getElementById("cropName").innerText=getName(crop);
    document.getElementById("cropFarmer").innerText=getFarmer(crop);
    document.getElementById("cropQuantity").innerText=crop.quantity??"-";
    document.getElementById("cropQuality").innerText=crop.quality??"-";
    document.getElementById("cropLocation").innerText=crop.location||"Unknown";
    document.getElementById("cropTime").innerText=formatDT(crop.datetime);
    document.getElementById("biddingStatus").innerHTML=isAuctionOpen(crop)?"<span style='color:green;'>🟢 Bidding Open</span>":"<span style='color:red;'>🔴 Bidding Closed</span>";

    const gallery=document.getElementById("popupImageGallery");
    gallery.innerHTML="";
    const imgs=crop.images?.length ? crop.images : (crop.image?[crop.image]:[]);
    if(!imgs.length) gallery.innerHTML="<p>No images available.</p>";
    else imgs.forEach(src=>{ const i=document.createElement("img"); i.src=src; i.style.width="80px"; gallery.appendChild(i); });

    popup.style.display="block";
    overlay.style.display="block";
}

// -------------------- CHAT --------------------
function openChat(cropId){
    if(!currentUser || !currentUser.email){ alert("Please login first!"); window.location.href="/login"; return; }
    localStorage.setItem("chatCropId",cropId);
    window.location.href=`/chat?crop_id=${encodeURIComponent(cropId)}`;
}

// -------------------- SEARCH & FILTER --------------------
function applyFilter(){
    const loc=(locationInput?.value||"").trim().toLowerCase();
    const q=(searchInput?.value||"").trim().toLowerCase();
    const filtered=crops.filter(c=>{
        const status=(c.status||"").toLowerCase();
        if(status==="closed"||status==="sold") return false;
        if(!isAuctionOpen(c)) return false;
        if(loc && !((c.location||"").toLowerCase().includes(loc))) return false;
        if(q && !getName(c).toLowerCase().includes(q)) return false;
        return true;
    });
    displayCrops(filtered);
}

// -------------------- INIT --------------------
document.addEventListener("DOMContentLoaded",()=>{
    cropsContainer=document.getElementById("crops-container")||document.getElementById("cropContainer")||document.getElementById("crop-container");
    wonContainer=document.getElementById("wonCropsContainer");
    noCropsMessage=document.getElementById("noCropsMessage");
    wishlistCountEl=document.getElementById("wishlist-count");
    searchInput=document.getElementById("search");
    filterBtn=document.getElementById("filterBtn");
    locationInput=document.getElementById("locationInput");

    loadSessionData();
    if(!currentUser||!currentUser.email){ alert("Please login to view crops."); window.location.href="/login"; return; }

    document.getElementById("popupOverlay")?.addEventListener("click",()=>{
        document.getElementById("detailsPopup").style.display="none";
        document.getElementById("popupOverlay").style.display="none";
    });

    filterBtn?.addEventListener("click",applyFilter);
    searchInput?.addEventListener("input",applyFilter);
    locationInput?.addEventListener("keyup",e=>{if(e.key==="Enter") applyFilter();});

    updateWishlistCount();
    fetchCrops();
    fetchWonCrops();
});
