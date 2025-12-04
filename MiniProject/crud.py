# ------------------ crud.py (fixed) ------------------
from bson.objectid import ObjectId
from datetime import datetime
from pymongo import MongoClient
from dotenv import load_dotenv
import os

load_dotenv()
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "crop_db")

client = MongoClient(MONGO_URI)
db = client[DB_NAME]


# -------------------- USERS --------------------

def get_user_by_email(email):
    return db.users.find_one({"email": email})


def get_user_by_id(user_id):
    try:
        user = db.users.find_one({"_id": ObjectId(user_id)})
        if user:
            user["_id"] = str(user["_id"])
        return user
    except Exception:
        return None


def create_user(user_data):
    return db.users.insert_one(user_data)


def update_user(user_id, update_fields):
    try:
        result = db.users.update_one(
            {"_id": ObjectId(user_id)},
            {"$set": update_fields}
        )
        return result.modified_count > 0
    except Exception as e:
        print(f"User update error: {e}")
        return False



# -------------------- CROPS --------------------

def create_crop(crop_data):
    """
    Insert a new crop with normalized structure and default values.
    """
    # Normalize datetime
    if "datetime" in crop_data:
        try:
            if isinstance(crop_data["datetime"], datetime):
                crop_data["datetime"] = crop_data["datetime"].isoformat()
            else:
                _ = datetime.fromisoformat(crop_data["datetime"])
        except Exception:
            crop_data["datetime"] = datetime.utcnow().isoformat()
    else:
        crop_data["datetime"] = datetime.utcnow().isoformat()

    # Default location
    crop_data["location"] = crop_data.get("location", "").strip() or "Not specified"

    # Ensure numeric fields
    for key in ["price", "quantity"]:
        try:
            crop_data[key] = float(crop_data.get(key, 0) or 0)
        except Exception:
            crop_data[key] = 0.0

    # Handle images
    images = []
    if "images" in crop_data and isinstance(crop_data["images"], list):
        images = crop_data["images"]
    elif "image" in crop_data and crop_data["image"]:
        images = [crop_data["image"]]

    if not images:
        images = ["/static/default_crop.jpg"]

    crop_data["images"] = images
    crop_data["image"] = images[0]

    # Defaults
    crop_data["name"] = crop_data.get("name", "").strip() or "Unnamed"
    crop_data["type"] = crop_data.get("type", "").strip() or "-"
    crop_data["quality"] = crop_data.get("quality", "").strip() or "-"
    crop_data["status"] = crop_data.get("status", "Available")
    crop_data["sold"] = bool(crop_data.get("sold", False))
    crop_data["notes"] = crop_data.get("notes", "").strip()

    # farmer_id may be provided as string; store as string to avoid accidental ObjectId conversions
    # (frontend/session stores ids as strings). Keep it consistent.
    if "farmer_id" in crop_data and isinstance(crop_data["farmer_id"], ObjectId):
        crop_data["farmer_id"] = str(crop_data["farmer_id"])

    return db.crops.insert_one(crop_data)


def get_crops():
    """
    Fetch all crops, normalized.
    """
    crops = list(db.crops.find())
    for c in crops:
        c["_id"] = str(c["_id"])
        if "images" not in c or not isinstance(c["images"], list):
            c["images"] = [c.get("image", "/static/default_crop.jpg")]
        c["image"] = c.get("image") or c["images"][0]
    return crops


def get_crop(crop_id):
    """
    Fetch single crop by ID.
    """
    try:
        crop = db.crops.find_one({"_id": ObjectId(crop_id)})
    except Exception:
        return None

    if crop:
        crop["_id"] = str(crop["_id"])
        if "images" not in crop or not isinstance(crop["images"], list):
            crop["images"] = [crop.get("image", "/static/default_crop.jpg")]
        crop["image"] = crop.get("image") or crop["images"][0]
    return crop


def update_crop(crop_id, crop_data):
    """
    Update crop details.
    """
    crop_data.pop("_id", None)
    crop_data["location"] = crop_data.get("location", "").strip() or "Not specified"

    for key in ["price", "quantity"]:
        if key in crop_data:
            try:
                crop_data[key] = float(crop_data[key])
            except Exception:
                crop_data[key] = 0.0

    if "images" in crop_data and isinstance(crop_data["images"], list):
        crop_data["image"] = crop_data["images"][0]

    return db.crops.update_one({"_id": ObjectId(crop_id)}, {"$set": crop_data})


def delete_crop(crop_id):
    """
    Delete crop by ID safely.
    """
    try:
        return db.crops.delete_one({"_id": ObjectId(crop_id)})
    except Exception as e:
        print("Error deleting crop:", e)
        return None


# -------------------- BIDS --------------------

def place_bid(bid_data):
    """
    Add new bid document.
    Expected keys: crop_id (str), bidder_id (str), bid_price (float)
    """
    try:
        bid_doc = {
            "crop_id": ObjectId(bid_data["crop_id"]),
            "bidder_id": ObjectId(bid_data["bidder_id"]),
            "bid_price": float(bid_data["bid_price"]),
            "timestamp": datetime.utcnow()
        }
        # Insert bid
        res = db.bids.insert_one(bid_doc)
        # Update crop current price and highest_bidder (store string for frontend convenience)
        db.crops.update_one(
            {"_id": ObjectId(bid_data["crop_id"])},
            {"$set": {"price": float(bid_data["bid_price"]), "highest_bidder": str(bid_data["bidder_id"])}}
        )
        return res
    except Exception as e:
        print("Error placing bid:", e)
        return None


def get_bids_for_crop(crop_id):
    try:
        oid = ObjectId(crop_id)
    except Exception:
        return []

    bids = list(db.bids.find({"crop_id": oid}).sort("bid_price", -1))
    for b in bids:
        b["_id"] = str(b["_id"])
        b["crop_id"] = str(b["crop_id"])
        b["bidder_id"] = str(b["bidder_id"])
        # convert timestamp to iso for API
        if isinstance(b.get("timestamp"), datetime):
            b["timestamp"] = b["timestamp"].isoformat()
    return bids


def get_highest_bid(crop_id):
    bids = get_bids_for_crop(crop_id)
    return bids[0] if bids else None


# -------------------- AUCTION WINNERS --------------------

def set_auction_winner(crop_id, user_id, bid_price=None):
    """
    Persist winner record in auction_winners collection.
    """
    try:
        db.auction_winners.update_one(
            {"crop_id": ObjectId(crop_id)},
            {
                "$set": {
                    "user_id": ObjectId(user_id),
                    "assigned_at": datetime.utcnow(),
                    "bid_price": float(bid_price) if bid_price is not None else None
                }
            },
            upsert=True
        )
        return True
    except Exception as e:
        print("Error setting winner:", e)
        return False


def get_auction_winner(crop_id):
    try:
        row = db.auction_winners.find_one({"crop_id": ObjectId(crop_id)})
    except Exception:
        return None

    if not row:
        return None

    row["_id"] = str(row["_id"])
    row["crop_id"] = str(row["crop_id"])
    row["user_id"] = str(row["user_id"])
    if isinstance(row.get("assigned_at"), datetime):
        row["assigned_at"] = row["assigned_at"].isoformat()
    return row


def determine_and_set_winner(crop_id):
    """
    Find the highest bid for a crop and set auction winner + create won_crops record.
    Returns winner doc or None.
    """
    try:
        highest = db.bids.find({"crop_id": ObjectId(crop_id)}).sort("bid_price", -1).limit(1)
        highest = list(highest)
        if not highest:
            return None
        hb = highest[0]
        user_id = str(hb["bidder_id"]) if isinstance(hb.get("bidder_id"), ObjectId) else str(hb.get("bidder_id"))
        bid_price = float(hb.get("bid_price", 0))
        # persist winner
        ok = set_auction_winner(crop_id, user_id, bid_price)
        if not ok:
            print("Failed to persist auction winner")
            return None
        # mark crop as sold/closed
        db.crops.update_one({"_id": ObjectId(crop_id)}, {"$set": {"status": "Closed", "sold": True}})
        # add to won_crops
        add_won_crop(user_id, crop_id, db.crops.find_one({"_id": ObjectId(crop_id)}).get("farmer_id"), bid_price)
        return get_auction_winner(crop_id)
    except Exception as e:
        print("Error determining winner:", e)
        return None


# -------------------- WON CROPS (BIDDER'S WON CROPS) --------------------

def add_won_crop(user_id, crop_id, farmer_id, bid_price, won_at=None):
    try:
        doc = {
            "user_id": ObjectId(user_id),       # bidder id
            "farmer_id": ObjectId(farmer_id) if farmer_id is not None else None,
            "crop_id": ObjectId(crop_id),
            "bid_price": float(bid_price),
            "won_at": won_at or datetime.utcnow()
        }
        return db.won_crops.insert_one(doc)
    except Exception as e:
        print(f"Error adding won crop: {e}")
        return None


def get_won_crops_for_user(user_id):
    try:
        user_obj_id = ObjectId(user_id)
    except Exception:
        return []

    won_list = list(db.won_crops.find({"user_id": user_obj_id}).sort("won_at", -1))
    # Populate crop details in each won crop entry
    for entry in won_list:
        entry["_id"] = str(entry["_id"])
        entry["user_id"] = str(entry["user_id"])
        entry["crop_id"] = str(entry["crop_id"])
        # fetch crop details safely
        try:
            crop = db.crops.find_one({"_id": ObjectId(entry["crop_id"])})
            if crop:
                crop["_id"] = str(crop["_id"])
                entry["crop"] = crop
        except Exception:
            entry["crop"] = None
        # convert won_at to iso
        if isinstance(entry.get("won_at"), datetime):
            entry["won_at"] = entry["won_at"].isoformat()
    return won_list

# ----------- DELETE WON CROPS --------
def delete_won_crop(user_id, crop_id):
    """
    Deletes a won crop record for a specific user and crop.
    Returns True if a record was deleted, False otherwise.
    """
    try:
        result = db.won_crops.delete_one({
            "user_id": str(user_id),
            "crop_id": str(crop_id)
        })
        return result.deleted_count > 0
    except Exception as e:
        print("delete_won_crop error:", e)
        return False



# -------------------- CHAT / MESSAGES --------------------

def send_message(crop_id, sender_id, receiver_id, message):
    """
    Insert a chat message into 'messages' collection (app.py expects db.messages).
    """
    try:
        doc = {
            "crop_id": ObjectId(crop_id),
            "sender_id": ObjectId(sender_id),
            "receiver_id": ObjectId(receiver_id),
            "message": str(message),
            "timestamp": datetime.utcnow()
        }
        return db.messages.insert_one(doc)
    except Exception as e:
        print("Error sending message:", e)
        return None


def get_messages_for_crop(crop_id):
    try:
        oid = ObjectId(crop_id)
    except Exception:
        return []

    msgs = list(db.messages.find({"crop_id": oid}).sort("timestamp", 1))
    for m in msgs:
        m["_id"] = str(m["_id"])
        m["crop_id"] = str(m["crop_id"])
        m["sender_id"] = str(m["sender_id"])
        m["receiver_id"] = str(m["receiver_id"])
        if isinstance(m.get("timestamp"), datetime):
            m["timestamp"] = m["timestamp"].isoformat()
    return msgs


# -------------------- UTILITIES --------------------

def ensure_indexes():
    """
    Create helpful indexes.
    """
    try:
        db.crops.create_index("datetime")
        db.crops.create_index("location")
        db.bids.create_index([("crop_id", 1), ("bid_price", -1)])
        db.messages.create_index([("crop_id", 1), ("timestamp", 1)])
        db.auction_winners.create_index("crop_id")
        db.won_crops.create_index([("user_id", 1), ("won_at", -1)])
    except Exception as e:
        print("Index creation failed:", e)


# ------------------ END OF crud.py ------------------


