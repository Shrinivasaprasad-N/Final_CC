let crops = [];
let cropsContainer, uploadBtn, uploadModal, cancelUpload, uploadForm;
let popupOverlay, closePopup;
let fName, fType, fQuality, fPrice, fQuantity, fDateTime, fImage, fNotes, fLocation;
let imagePreviewContainer;
let popupImageGallery, popupTitle, popupType, popupQuality, popupPrice, popupQuantity;
let popupDateTime, popupStatus, popupSold, popupNotes, popupLocation, popupChatBtn;

document.addEventListener("DOMContentLoaded", () => {
  initializeApp();

  // Profile button handler
  const profileBtn = document.getElementById("profileBtn");
  if (profileBtn) {
    profileBtn.addEventListener("click", () => {
      window.location.href = "/profile";
    });
  }
});

function initializeApp() {
  cropsContainer = document.getElementById("cropsContainer");
  uploadBtn = document.getElementById("uploadBtn");
  uploadModal = document.getElementById("uploadModal");
  cancelUpload = document.getElementById("cancelUpload");
  uploadForm = document.getElementById("uploadForm");
  popupOverlay = document.getElementById("popupOverlay");
  closePopup = document.getElementById("closePopup");

  fName = document.getElementById("cropName");
  fType = document.getElementById("cropType");
  fQuality = document.getElementById("cropQuality");
  fPrice = document.getElementById("cropPrice");
  fQuantity = document.getElementById("cropQuantity");
  fDateTime = document.getElementById("plantedDateTime");
  fImage = document.getElementById("cropImage");
  fNotes = document.getElementById("cropNotes");
  fLocation = document.getElementById("cropLocation");
  imagePreviewContainer = document.getElementById("imagePreviewContainer");

  popupImageGallery = document.getElementById("popupImageGallery");
  popupTitle = document.getElementById("popupTitle");
  popupType = document.getElementById("popupType");
  popupQuality = document.getElementById("popupQuality");
  popupPrice = document.getElementById("popupPrice");
  popupQuantity = document.getElementById("popupQuantity");
  popupDateTime = document.getElementById("popupDateTime");
  popupStatus = document.getElementById("popupStatus");
  popupSold = document.getElementById("popupSold");
  popupNotes = document.getElementById("popupNotes");
  popupLocation = document.getElementById("popupLocation");
  popupChatBtn = document.getElementById("chatWithBidderBtn");

  setupEventListeners();
  loadCropsFromServer();
  autoFillLocation();
}

function setupEventListeners() {
  uploadBtn.addEventListener("click", () => {
    clearForm();
    uploadForm.dataset.editingId = "";
    uploadModal.style.display = "flex";
    autoFillLocation();
  });

  cancelUpload.addEventListener("click", () => {
    uploadModal.style.display = "none";
  });

  closePopup.addEventListener("click", () => {
    popupOverlay.style.display = "none";
  });

  uploadModal.addEventListener("click", (e) => {
    if (e.target === uploadModal) uploadModal.style.display = "none";
  });

  popupOverlay.addEventListener("click", (e) => {
    if (e.target === popupOverlay) popupOverlay.style.display = "none";
  });

  uploadForm.addEventListener("submit", handleFormSubmit);

  if (fImage) {
    fImage.addEventListener("change", (e) => {
      const files = Array.from(e.target.files || []);
      imagePreviewContainer.innerHTML = "";
      if (files.length === 0) {
        imagePreviewContainer.style.display = "none";
        return;
      }
      files.forEach((file) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const img = document.createElement("img");
          img.src = ev.target.result;
          img.alt = file.name || "preview";
          img.style.maxHeight = "100px";
          img.style.marginRight = "8px";
          imagePreviewContainer.appendChild(img);
        };
        reader.readAsDataURL(file);
      });
      imagePreviewContainer.style.display = "flex";
    });
  }
}

async function autoFillLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude.toFixed(4);
      const lon = pos.coords.longitude.toFixed(4);
      const readable = await getReadableLocation(lat, lon);
      if (fLocation) fLocation.value = readable ? `${readable} (${lat}, ${lon})` : `${lat}, ${lon}`;
    },
    (err) => console.warn("Location unavailable:", err)
  );
}

async function getReadableLocation(lat, lon) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
    const data = await res.json();
    return data.display_name ? data.display_name.split(",").slice(0, 3).join(",") : null;
  } catch (e) {
    console.warn("Reverse geocode failed", e);
    return null;
  }
}

async function loadCropsFromServer() {
  try {
    const response = await fetch("/api/crops");
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to fetch crops: ${response.status} ${text}`);
    }
    const data = await response.json();
    crops = Array.isArray(data) ? data.map((c) => ({ ...c, id: c._id || c.id })) : [];
    displayCrops();
  } catch (error) {
    console.error(error);
    if (cropsContainer) {
      cropsContainer.innerHTML = `<p class="error">Failed to load crops. ${error.message}</p>`;
    }
    alert(`Error loading crops: ${error.message}`);
  }
}

// Updated displayCrops function: separate sold and unsold crops, show bidder info
function displayCrops() {
  if (!cropsContainer) return;
  cropsContainer.innerHTML = "";

  if (!crops || crops.length === 0) {
    cropsContainer.innerHTML = `<p class="no-data">No crops found. Add a crop using "Upload Crop".</p>`;
    return;
  }

  const unsoldCrops = crops.filter(c => !c.sold);
  const soldCrops = crops.filter(c => c.sold);

  // ---------------- UNSOLD CROPS ----------------
  if (unsoldCrops.length) {
    const unsoldTitle = document.createElement("h2");
    unsoldTitle.textContent = "Available Crops";
    cropsContainer.appendChild(unsoldTitle);
    unsoldCrops.forEach(crop => {
      const cropCard = createCropCard(crop);

      // For unsold crops: remove chat button
      const actions = cropCard.querySelector(".crop-actions");
      if (actions) {
        const chatBtn = actions.querySelector(".chat-btn");
        if (chatBtn) chatBtn.remove(); // Remove chat button
      }

      cropsContainer.appendChild(cropCard);
    });
  }

  // ---------------- SOLD CROPS ----------------
  if (soldCrops.length) {
    const soldTitle = document.createElement("h2");
    soldTitle.textContent = "Sold / Won Crops";
    cropsContainer.appendChild(soldTitle);
    soldCrops.forEach(crop => {
      const cropCard = createCropCard(crop);
      const infoDiv = cropCard.querySelector(".crop-info");

      if (crop.winner_name || crop.sold_price) {
        const extra = document.createElement("p");
        extra.innerHTML = `<strong>Sold to:</strong> ${crop.winner_name || "Unknown bidder"} | <strong>Sold Price:</strong> ₹${crop.sold_price || crop.price}`;
        infoDiv.appendChild(extra);
      }

      // For sold crops: show only chat button, remove edit/delete
      const actions = cropCard.querySelector(".crop-actions");
      if (actions) {
        // Remove edit and delete buttons
        const editBtn = actions.querySelector(".edit-btn");
        const deleteBtn = actions.querySelector(".delete-btn");
        if (editBtn) editBtn.remove();
        if (deleteBtn) deleteBtn.remove();

        // Ensure chat button exists
        const chatBtn = actions.querySelector(".chat-btn");
        if (!chatBtn) {
          const newChatBtn = document.createElement("button");
          newChatBtn.className = "chat-btn";
          newChatBtn.textContent = "💬 Chat";
          newChatBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            window.location.href = `/chat?crop_id=${crop.id}`;
          });
          actions.appendChild(newChatBtn);
        }
      }

      cropsContainer.appendChild(cropCard);
    });
  }
}


function createCropCard(crop) {
  const card = document.createElement("div");
  card.className = "crop-card";

  const img = document.createElement("img");
  img.className = "crop-image";
  const firstImg = (crop.images && crop.images.length > 0 ? crop.images[0] : null) || crop.image || "https://via.placeholder.com/300x200?text=No+Image";
  img.src = firstImg;
  img.alt = crop.name || "Unnamed crop";
  img.addEventListener("click", () => showCropDetails(crop.id));

  const info = document.createElement("div");
  info.className = "crop-info";
  info.innerHTML = `
    <h3>${crop.name || "Unnamed"}</h3>
    <p>Type: ${crop.type || "-"}</p>
    <p>Quality: ${crop.quality || "-"}</p>
    <p>Price: ₹${crop.price !== undefined ? crop.price : 0}/kg</p>
    <p>Qty: ${crop.quantity !== undefined ? crop.quantity : 0} kg</p>
    <p>📍 ${crop.location || "Not specified"}</p>
  `;

  const actions = document.createElement("div");
  actions.className = "crop-actions";

  const editBtn = document.createElement("button");
  editBtn.className = "edit-btn";
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    editCrop(crop.id);
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "delete-btn";
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    deleteCrop(crop.id);
  });

  const chatBtn = document.createElement("button");
  chatBtn.className = "chat-btn";
  chatBtn.textContent = "💬 Chat";
  chatBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    // Redirect to chat page with cropId parameter
    window.location.href = `/chat?crop_id=${crop.id}`;
  });

  actions.append(editBtn, deleteBtn, chatBtn);
  card.append(img, info, actions);
  return card;
}


// All remaining functions remain exactly as in your original f_portal.js
function showCropDetails(cropId) {
  const crop = crops.find((c) => c.id === cropId);
  if (!crop) return;

  popupImageGallery.innerHTML = "";
  const imgs = crop.images && crop.images.length ? crop.images : (crop.image ? [crop.image] : []);
  if (imgs.length === 0) {
    popupImageGallery.innerHTML = `<img src="https://via.placeholder.com/300x200?text=No+Image" alt="No image">`;
  } else {
    imgs.forEach(src => {
      const imgEl = document.createElement("img");
      imgEl.src = src;
      popupImageGallery.appendChild(imgEl);
    });
  }

  popupTitle.textContent = crop.name || "-";
  popupType.textContent = crop.type || "-";
  popupQuality.textContent = crop.quality || "-";
  popupPrice.textContent = crop.price !== undefined ? "₹" + crop.price : "-";
  popupQuantity.textContent = crop.quantity !== undefined ? crop.quantity + " kg" : "-";
  popupDateTime.textContent = crop.datetime ? formatDate(crop.datetime) : "-";
  popupStatus.textContent = crop.status || "Available";
  popupSold.textContent = crop.sold ? "Yes" : "No";
  popupNotes.textContent = crop.notes || "-";
  popupLocation.textContent = crop.location || "Not specified";

  if (crop.sold && (crop.winner_name || crop.sold_price)) {
    popupNotes.textContent += `\nSold to: ${crop.winner_name || "Unknown"} | Price: ₹${crop.sold_price || crop.price}`;
  }

  if (popupChatBtn) {
    popupChatBtn.style.display = crop.sold ? "none" : "inline-block";
    popupChatBtn.onclick = () => window.location.href = `/chat?crop_id=${crop.id}`;
  }

  popupOverlay.style.display = "flex";
}

function editCrop(cropId) {
  const crop = crops.find((c) => c.id === cropId);
  if (!crop) return;

  fName.value = crop.name || "";
  fType.value = crop.type || "";
  fQuality.value = crop.quality || "";
  fPrice.value = crop.price || "";
  fQuantity.value = crop.quantity || "";
  fDateTime.value = crop.datetime ? new Date(crop.datetime).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16);
  fNotes.value = crop.notes || "";
  fLocation.value = crop.location || "";

  imagePreviewContainer.innerHTML = "";
  const imgs = crop.images && crop.images.length ? crop.images : (crop.image ? [crop.image] : []);
  imgs.forEach((src) => {
    const img = document.createElement("img");
    img.src = src;
    img.style.maxHeight = "100px";
    img.style.marginRight = "8px";
    imagePreviewContainer.appendChild(img);
  });
  imagePreviewContainer.style.display = imgs.length ? "flex" : "none";

  uploadForm.dataset.editingId = cropId;
  uploadModal.style.display = "flex";
}

function deleteCrop(cropId) {
  if (!confirm("Are you sure you want to delete this crop?")) return;

  fetch(`/api/crops/${cropId}`, { method: "DELETE" })
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to delete crop, status: ${res.status}`);
      return res.json();
    })
    .then(() => {
      loadCropsFromServer();
      alert("Crop deleted successfully!");
    })
    .catch((err) => {
      console.error("Error deleting crop:", err);
      alert("Error deleting crop. Check console.");
    });
}

function handleFormSubmit(e) {
  e.preventDefault();

  if (!fName.value.trim()) return alert("Please enter crop name");
  if (!fLocation.value.trim()) return alert("Please enter or wait for location");

  const editingId = uploadForm.dataset.editingId || "";
  const datetimeValue = fDateTime.value ? new Date(fDateTime.value).toISOString() : new Date().toISOString();

  const cropData = {
    name: fName.value.trim(),
    type: fType.value.trim(),
    quality: fQuality.value.trim(),
    price: parseFloat(fPrice.value) || 0,
    quantity: parseFloat(fQuantity.value) || 0,
    datetime: datetimeValue,
    location: fLocation.value.trim(),
    status: "Available",
    sold: false,
    notes: fNotes.value.trim(),
  };

  const formData = new FormData();
  for (const key in cropData) formData.append(key, cropData[key]);

  if (fImage && fImage.files && fImage.files.length > 0) {
    Array.from(fImage.files).forEach(file => {
      formData.append("cropImages", file, file.name);
    });
  }

  saveCropToServer(formData, editingId);
}

function saveCropToServer(formData, editingId) {
  const url = editingId ? `/api/crops/${editingId}` : "/api/crops";
  const method = editingId ? "PUT" : "POST";

  fetch(url, {
    method,
    body: formData,
  })
    .then((res) => {
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      return res.json();
    })
    .then(() => {
      loadCropsFromServer();
      uploadModal.style.display = "none";
      alert(editingId ? "Crop updated successfully!" : "Crop added successfully!");
    })
    .catch((err) => {
      console.error("Error saving crop:", err);
      alert("Error saving crop. Check console.");
    });
}

function formatDate(dateString) {
  if (!dateString) return "-";
  const date = new Date(dateString);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function clearForm() {
  uploadForm.reset();
  fDateTime.value = new Date().toISOString().slice(0, 16);
  imagePreviewContainer.innerHTML = "";
  imagePreviewContainer.style.display = "none";
}

console.log("✅ f_portal.js loaded — multi-image + chat integration complete with sold crops section.");
