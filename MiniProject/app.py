# ------------------ app.py (fixed) ------------------
from flask import Flask, request, jsonify, render_template, session, redirect
from flask_cors import CORS
from bson.objectid import ObjectId
from datetime import datetime, timedelta, timezone
import bcrypt
import os
from flask_pymongo import PyMongo
from pymongo import ReturnDocument

# Import CRUD functions from your module
from crud import (
    get_user_by_email, create_user, get_crops, create_crop,
    update_crop, delete_crop, get_crop, get_highest_bid,
    place_bid as crud_place_bid, get_auction_winner, db,
    get_user_by_id, update_user, get_won_crops_for_user, add_won_crop,
    determine_and_set_winner, send_message, get_messages_for_crop, delete_won_crop
)

app = Flask(__name__, static_folder='static', template_folder='templates')

app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-key")
CORS(app, supports_credentials=True)

mongo = PyMongo()
app.config["MONGO_URI"] = os.environ.get("MONGO_URI", "mongodb://localhost:27017/crop_connect")
mongo.init_app(app)


# Basic routes
@app.route("/", methods=["GET"])
def register():
    return render_template("register.html")


@app.route("/login", methods=["GET"])
def login():
    return render_template("index.html")


@app.route("/farmerportal")
def farmer_portal():
    return render_template("f_portal.html")


@app.route("/bidderportal")
def bidder_portal():
    return render_template("b_portal.html")

@app.route("/wishlist")
def wishlist_page():
    return render_template("wishlist.html")

@app.route('/bid_portal')
def bid_portal():
    return render_template('bidding/bid_portal.html')


# Authentication APIs
@app.route("/api/auth/register", methods=["POST"])
def register_api():
    data = request.get_json()
    if not data or not all(k in data for k in ("username", "email", "password")):
        return jsonify({"error": "Missing required fields"}), 400
    if get_user_by_email(data["email"]):
        return jsonify({"error": "Email already exists"}), 400
    hashed_pw = bcrypt.hashpw(data["password"].encode(), bcrypt.gensalt())
    user = {
        "username": data["username"],
        "email": data["email"],
        "password": hashed_pw,
        "role": data.get("role", "bidder")
    }
    create_user(user)
    return jsonify({"message": "User registered successfully"}), 201


@app.route("/api/auth/login", methods=["POST"])
def login_api():
    data = request.get_json()
    if not data or not all(k in data for k in ("email", "password")):
        return jsonify({"error": "Missing credentials"}), 400
    user = get_user_by_email(data["email"])
    if not user or not bcrypt.checkpw(data["password"].encode(), user["password"]):
        return jsonify({"error": "Invalid credentials"}), 400
    session["logged_in_user"] = {
        "id": str(user["_id"]),
        "username": user.get("username"),
        "role": user.get("role", "bidder"),
        "email": user.get("email")
    }
    return jsonify({
        "message": "Login successful",
        "user": {
            "id": str(user["_id"]),
            "username": user["username"],
            "role": user["role"],
            "email": user["email"]
        }
    }), 200


@app.route("/api/auth/logout", methods=["POST"])
def logout_api():
    session.pop("logged_in_user", None)
    return jsonify({"message": "Logged out"}), 200


# Route to serve profile page (frontend renders profile form)
@app.route("/profile")
def profile():
    user = session.get("logged_in_user")
    if not user:
        return redirect("/login")
    return render_template("profile.html", user=user)


# API: get current user profile data
@app.route("/api/profile", methods=["GET"])
def get_profile():
    user = session.get("logged_in_user")
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    user_data = get_user_by_id(user["id"])
    if not user_data:
        return jsonify({"error": "User not found"}), 404
    user_data.pop("password", None)  # Don't expose password hash
    return jsonify(user_data), 200


# API: update profile info including profile picture
@app.route("/api/profile", methods=["POST", "PUT"])
def update_profile():
    user = session.get("logged_in_user")
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    if request.is_json:
        data = request.get_json()
    else:
        data = request.form.to_dict()

    update_fields = {}

    # Allowed fields users can update
    allowed_fields = ["username", "email", "phone", "address"]  # Extend as needed

    for field in allowed_fields:
        if field in data:
            update_fields[field] = data[field].strip()

    if "profile_picture" in request.files:
        file = request.files["profile_picture"]
        if file and file.filename:
            upload_folder = os.path.join(app.static_folder, "profile_pics")
            os.makedirs(upload_folder, exist_ok=True)
            filepath = os.path.join(upload_folder, file.filename)
            file.save(filepath)
            upload_path = "/" + os.path.relpath(filepath, start=".").replace("\\", "/")
            update_fields["profile_picture"] = upload_path

    success = update_user(user["id"], update_fields)
    if not success:
        return jsonify({"error": "Update failed"}), 400

    # Update session info for username/email if changed
    if "username" in update_fields:
        session["logged_in_user"]["username"] = update_fields["username"]
    if "email" in update_fields:
        session["logged_in_user"]["email"] = update_fields["email"]

    return jsonify({"message": "Profile updated successfully"}), 200


# Helper to check if string is data URL
def _is_data_url(s: str):
    return isinstance(s, str) and s.startswith("data:")


# List crops API filtering by status and expiration
@app.route("/api/crops", methods=["GET"])
def list_crops():
    try:
        crops = get_crops()  # fetch all crops from DB
        result = []

        for c in crops:
            c["_id"] = str(c["_id"])
            c["sold"] = bool(c.get("sold", False)) or (c.get("status", "").lower() == "closed")
            c["farmer_name"] = c.get("farmer_name") or c.get("farmer") or "Unknown Farmer"
            c["farmer_id"] = c.get("farmer_id") or c.get("farmer") or ""
            c["buyer_name"] = c.get("buyer_name") or "Unknown"

            if "images" not in c or not isinstance(c["images"], list):
                c["images"] = [c["image"]] if c.get("image") else []

            # ensure datetime is ISO string
            crop_time = c.get("datetime")
            if isinstance(crop_time, str):
                try:
                    crop_time = datetime.fromisoformat(crop_time)
                except Exception:
                    crop_time = datetime.now(timezone.utc)
            if isinstance(crop_time, datetime) and crop_time.tzinfo is None:
                crop_time = crop_time.replace(tzinfo=timezone.utc)
            c["datetime"] = crop_time.isoformat()

            result.append(c)

        # always return flat array — farmer portal expects this
        return jsonify(result), 200

    except Exception as e:
        print("🔥 Error in list_crops:", e)
        return jsonify({"error": str(e)}), 500


# Add crop API: handle files, data URLs, session farmer info
@app.route("/api/crops", methods=["POST"])
def add_crop():
    if request.is_json:
        data = request.get_json()
    else:
        data = request.form.to_dict()

    # Attach farmer info from session
    user = session.get("logged_in_user")
    if user:
        data["farmer_id"] = user.get("id")
        data["farmer_name"] = user.get("username")
        data["farmer_email"] = user.get("email")

    # Convert numeric fields
    for key in ["price", "quantity"]:
        if key in data and data[key] != "":
            try:
                data[key] = float(data[key])
            except Exception:
                data[key] = 0.0

    # Ensure datetime
    if data.get("datetime"):
        try:
            datetime.fromisoformat(data["datetime"])
        except Exception:
            data["datetime"] = datetime.utcnow().isoformat()
    else:
        data["datetime"] = datetime.utcnow().isoformat()

    data["location"] = data.get("location", "").strip() or "Not specified"

    # Handle images
    images = []
    if request.is_json and data.get("images"):
        if isinstance(data["images"], list):
            images = [img for img in data["images"] if _is_data_url(img)]
        elif _is_data_url(data["images"]):
            images.append(data["images"])
    else:
        upload_folder = os.path.join(app.static_folder, "uploads")
        os.makedirs(upload_folder, exist_ok=True)
        files = request.files.getlist("cropImages") or [request.files.get("cropImage")]
        for f in files:
            if f and f.filename != "":
                path = os.path.join(upload_folder, f.filename)
                f.save(path)
                images.append("/" + os.path.relpath(path, start=".").replace("\\", "/"))
    if not images:
        images = ["/static/default_crop.jpg"]

    data["image"] = images[0]
    data["images"] = images
    data["status"] = "Available"
    data["sold"] = False  # ✅ Explicitly mark new crop as unsold

    result = create_crop(data)
    return jsonify({"message": "Crop added successfully", "id": str(result.inserted_id)}), 201


# Edit crop API supporting both JSON and multipart/form-data for images
@app.route("/api/crops/<crop_id>", methods=["PUT"])
def edit_crop(crop_id):
    if request.is_json:
        data = request.get_json()
    else:
        data = request.form.to_dict()

    if not data:
        return jsonify({"error": "Invalid data"}), 400

    for key in ["price", "quantity"]:
        if key in data and data[key] != "":
            try:
                data[key] = float(data[key])
            except Exception:
                pass

    data["location"] = data.get("location", "").strip() or "Not specified"

    new_images = []
    if request.is_json and data.get("images"):
        if isinstance(data["images"], list):
            new_images = [img for img in data["images"] if _is_data_url(img)]
    else:
        files = request.files.getlist("cropImages")
        if not files:
            single = request.files.get("cropImage")
            if single:
                files = [single]

        upload_folder = os.path.join(app.static_folder, "uploads")
        os.makedirs(upload_folder, exist_ok=True)
        for f in files:
            if f and f.filename != "":
                path = os.path.join(upload_folder, f.filename)
                f.save(path)
                new_images.append("/" + os.path.relpath(path, start=".").replace("\\", "/"))

    if new_images:
        data["images"] = new_images
        data["image"] = new_images[0]

    # preserve farmer info if logged in as farmer (session)
    user = session.get("logged_in_user")
    if user and user.get("role") == "farmer":
        if not data.get("farmer_id"):
            data["farmer_id"] = user.get("id")
            data["farmer_name"] = user.get("username")
            data["farmer_email"] = user.get("email")

    result = update_crop(crop_id, data)
    if getattr(result, "modified_count", 0) == 0:
        existing = get_crop(crop_id)
        if not existing:
            return jsonify({"error": "Crop not found"}), 404
    return jsonify({"message": "Crop updated"}), 200


# Delete crop API with cascade cleanup (attempt best-effort)
@app.route("/api/crops/<crop_id>", methods=["DELETE"])
def remove_crop(crop_id):
    try:
        crop_oid = ObjectId(crop_id)
    except Exception:
        return jsonify({"error": "Invalid crop ID"}), 400

    try:
        db.messages.delete_many({"crop_id": crop_oid})
    except Exception:
        pass
    try:
        db.bids.delete_many({"crop_id": crop_oid})
    except Exception:
        pass
    try:
        db.wishlist.delete_many({"crop_id": crop_oid})
    except Exception:
        pass

    result = delete_crop(crop_id)
    if not result or getattr(result, "deleted_count", 0) == 0:
        return jsonify({"error": "Crop not found"}), 404
    return jsonify({"message": "Crop deleted"}), 200




# -------------------- FETCH WON CROPS --------------------
@app.route("/api/won-crops", methods=["GET"])
def get_won_crops():
    user = session.get("logged_in_user")
    if not user:
        return jsonify([])  # no user logged in

    user_id = user["id"]

    # Fetch won crops for this user
    won_entries = list(db.won_crops.find({"user_id": user_id}))

    result = []
    for entry in won_entries:
        crop = db.crops.find_one({"_id": ObjectId(entry["crop_id"])})
        if crop:
            entry["crop"] = {
                "_id": str(crop["_id"]),
                "name": crop.get("name", "Unnamed"),
                "quantity": crop.get("quantity", "-"),
                "quality": crop.get("quality", "-"),
                "image": crop.get("image", "/static/default_crop.jpg"),
                "location": crop.get("location", "Unknown"),
                "datetime": crop.get("datetime"),
                "farmer_name": crop.get("farmer_name") or crop.get("farmer") or "Unknown Farmer"  # <-- added
            }
        result.append(entry)

    return jsonify(result)

# ------ DELETE WON CROP ---------------
@app.route("/api/delete_won_bid/<crop_id>", methods=["DELETE"])
def api_delete_won_bid(crop_id):
    try:
        user_id = request.args.get("user_id")
        if not user_id:
            return jsonify({"error": "User ID required"}), 400

        success = delete_won_crop(user_id, crop_id)
        if not success:
            return jsonify({"error": "Could not delete"}), 500

        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# -------------------- SAVE WON CROP --------------------
@app.route("/api/save_won_crop", methods=["POST"])
def save_won_crop():
    data = request.json
    user_id = data.get("user_id")
    crop_id = data.get("crop_id")
    farmer_id = data.get("farmer_id")
    bid_price = data.get("bid_price")

    if not all([user_id, crop_id, farmer_id, bid_price]):
        return jsonify({"error": "Missing fields"}), 400

    try:
        db.won_crops.update_one(
            {"user_id": user_id, "crop_id": crop_id},
            {"$set": {
                "user_id": user_id,
                "crop_id": crop_id,
                "farmer_id": farmer_id,
                "bid_price": bid_price,
                "datetime": datetime.utcnow()
            }},
            upsert=True
        )
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# -------------------- PLACE BID --------------------
@app.route("/api/place_bid", methods=["POST"])
def place_bid():
    data = request.json
    crop_id = data.get("crop_id")
    bidder_id = data.get("bidder_id")
    bidder_email = data.get("bidder_email")
    bid_price = data.get("bid_price")

    if not all([crop_id, bidder_id, bidder_email, bid_price]):
        return jsonify({"error": "Missing fields"}), 400

    try:
        crop_obj_id = ObjectId(crop_id)

        crop = db.crops.find_one({"_id": crop_obj_id})
        if not crop:
            return jsonify({"error": "Crop not found"}), 404

        if crop.get("status", "").lower() in ["closed", "sold"]:
            return jsonify({"error": "Bidding closed for this crop"}), 400

        # Get existing highest bid
        existing_bid = db.bids.find_one({"crop_id": crop_id})
        if existing_bid and bid_price <= existing_bid["bid_price"]:
            return jsonify({"error": f"Bid must be higher than current ₹{existing_bid['bid_price']}"}), 400

        # Save/update bid
        db.bids.update_one(
            {"crop_id": crop_id},
            {"$set": {
                "bidder_id": bidder_id,
                "bidder_email": bidder_email,
                "bid_price": bid_price,
                "datetime": datetime.utcnow()
            }},
            upsert=True
        )

        return jsonify({"success": True, "current_bid": bid_price})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# -------------------- GET CURRENT BID --------------------
@app.route("/api/current_bid/<crop_id>", methods=["GET"])
def current_bid(crop_id):
    try:
        bid = db.bids.find_one({"crop_id": crop_id})
        if not bid:
            return jsonify({"current_bid": None})
        return jsonify({
            "bid_price": bid["bid_price"],
            "bidder_email": bid["bidder_email"],
            "bidder_id": bid["bidder_id"]
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500





# Wishlist APIs
# Retrieve wishlist for a user with populated crop details
@app.route("/api/wishlist/<user_id>", methods=["GET"])
def get_wishlist(user_id):
    try:
        user_obj_id = ObjectId(user_id)
    except Exception:
        return jsonify({"error": "Invalid user ID"}), 400

    # Find wishlist items by user
    wishlist_items = list(db.wishlist.find({"user_id": user_obj_id}))

    # For each wishlist item, add crop details for convenience
    enriched_wishlist = []
    for item in wishlist_items:
        crop_id_obj = item.get("crop_id")
        crop_details = None
        if crop_id_obj:
            crop = db.crops.find_one({"_id": crop_id_obj})
            if crop:
                crop["_id"] = str(crop["_id"])
                crop_details = crop

        enriched_wishlist.append({
            "_id": str(item["_id"]),
            "crop_id": str(item["crop_id"]),
            "user_id": str(item["user_id"]),
            "added_at": item.get("added_at"),
            "crop": crop_details,
        })

    return jsonify(enriched_wishlist), 200


# Add item to wishlist safely
@app.route("/api/wishlist", methods=["POST"])
def add_to_wishlist():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing wishlist data"}), 400

    try:
        user_obj_id = ObjectId(data["user_id"])
        crop_obj_id = ObjectId(data["crop_id"])
    except Exception:
        return jsonify({"error": "Invalid user_id or crop_id"}), 400

    exists = db.wishlist.find_one({
        "user_id": user_obj_id,
        "crop_id": crop_obj_id
    })

    if exists:
        return jsonify({"error": "Already in wishlist"}), 400

    db.wishlist.insert_one({
        "user_id": user_obj_id,
        "crop_id": crop_obj_id,
        "added_at": datetime.utcnow()
    })
    return jsonify({"message": "Added to wishlist"}), 201


# Remove item from wishlist
@app.route("/api/wishlist/remove", methods=["POST"])
def remove_from_wishlist():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing data"}), 400

    try:
        user_obj_id = ObjectId(data["user_id"])
        crop_obj_id = ObjectId(data["crop_id"])
    except Exception:
        return jsonify({"error": "Invalid user_id or crop_id"}), 400

    result = db.wishlist.delete_one({
        "user_id": user_obj_id,
        "crop_id": crop_obj_id
    })

    if result.deleted_count == 0:
        return jsonify({"error": "Wishlist item not found"}), 404

    return jsonify({"message": "Removed from wishlist"}), 200


# Auction winner API - will determine winner if not already set
# -------------------- GET AUCTION WINNER --------------------
@app.route("/api/auction/winner/<crop_id>", methods=["GET"])
def auction_winner(crop_id):
    try:
        crop_obj_id = ObjectId(crop_id)
        crop = db.crops.find_one({"_id": crop_obj_id})
        if not crop:
            return jsonify({"error": "Crop not found"}), 404

        bid = db.bids.find_one({"crop_id": crop_id})
        if not bid:
            return jsonify({"error": "No bids placed yet"}), 404

        # Mark crop as sold and closed
        db.crops.update_one(
            {"_id": crop_obj_id},
            {"$set": {
                "status": "Closed",
                "sold": True,
                "winner": bid["bidder_email"],
                "winner_id": bid["bidder_id"],
                "sold_price": bid["bid_price"]
            }}
        )

        # Save in won_crops collection for bidder portal
        db.won_crops.update_one(
            {"user_id": bid["bidder_id"], "crop_id": crop_id},
            {"$set": {
                "user_id": bid["bidder_id"],
                "crop_id": crop_id,
                "farmer_id": crop.get("farmer_id"),
                "bid_price": bid["bid_price"],
                "datetime": datetime.utcnow()
            }},
            upsert=True
        )

        return jsonify({
            "user_id": bid["bidder_id"],
            "bidder_email": bid["bidder_email"],
            "bid_price": bid["bid_price"]
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500



# Chat system APIs
@app.route("/api/messages/<crop_id>", methods=["GET"])
def get_messages(crop_id):
    try:
        crop_oid = ObjectId(crop_id)
    except Exception:
        return jsonify([]), 200

    messages = get_messages_for_crop(crop_id)
    out = []
    for msg in messages:
        msg_obj = {
            "_id": msg.get("_id"),
            "crop_id": msg.get("crop_id"),
            "sender_id": msg.get("sender_id"),
            "receiver_id": msg.get("receiver_id"),
            "message": msg.get("message", ""),
            "timestamp": msg.get("timestamp")
        }
        try:
            sender = db.users.find_one({"_id": ObjectId(msg["sender_id"])})
            receiver = db.users.find_one({"_id": ObjectId(msg["receiver_id"])})
            msg_obj["sender_name"] = sender["username"] if sender else "Unknown"
            msg_obj["receiver_name"] = receiver["username"] if receiver else "Unknown"
        except Exception:
            msg_obj["sender_name"] = "Unknown"
            msg_obj["receiver_name"] = "Unknown"
        out.append(msg_obj)
    return jsonify(out), 200


@app.route("/api/messages", methods=["POST"])
def send_message_route():
    data = request.get_json()
    required = ["crop_id", "sender_id", "receiver_id", "message"]
    if not data or not all(k in data for k in required):
        return jsonify({"error": "Missing required fields"}), 400
    try:
        send_message(data["crop_id"], data["sender_id"], data["receiver_id"], data["message"].strip())
        return jsonify({"message": "Message sent"}), 201
    except Exception as e:
        print("Error:", e)
        return jsonify({"error": str(e)}), 400


# Chat page render with permissions
@app.route("/chat")
def chat():
    crop_id = request.args.get("crop_id")
    if not crop_id:
        return "Invalid crop ID", 400

    crop = get_crop(crop_id)
    if not crop:
        return "Crop not found", 404

    user = session.get("logged_in_user")
    if not user:
        return redirect("/login")

    # ✅ Convert ALL IDs to strings FIRST
    user_id = str(user.get("id"))
    crop_farmer_id = str(crop.get("farmer_id")) if crop.get("farmer_id") else None

    print(f"🔍 DEBUG - User: {user_id}, Crop farmer: {crop_farmer_id}")

    role = user.get("role")
    partner_id = None
    partner_name = None

    # ✅ Multiple fallback methods to get winner
    winner = None
    winner_user_id = None

    # Method 1: Try get_auction_winner
    if 'get_auction_winner' in globals():
        winner = get_auction_winner(crop_id)

    # Method 2: Direct DB lookup as fallback
    if not winner:
        try:
            bid = db.bids.find_one({"crop_id": crop_id})
            if bid:
                winner = {
                    "user_id": str(bid["bidder_id"]),
                    "bidder_id": str(bid["bidder_id"]),
                    "bidder_email": bid.get("bidder_email", "")
                }
        except:
            pass

    # Method 3: Check crop fields directly
    if not winner:
        crop_winner_id = crop.get("winner_id") or crop.get("highest_bidder")
        if crop_winner_id:
            winner_user_id = str(crop_winner_id)
            winner = {"user_id": winner_user_id}

    if winner:
        winner_user_id = str(winner.get("user_id") or winner.get("bidder_id") or "")

    print(f"🔍 DEBUG - Winner ID: {winner_user_id}")

    if role == "bidder":
        if not winner_user_id or winner_user_id != user_id:
            return f"Not authorized. Bidder expected winner_id={winner_user_id}, got user_id={user_id}", 403
        partner_id = crop_farmer_id
        partner_name = crop.get("farmer_name", "Farmer")
    elif role == "farmer":
        if not crop_farmer_id or crop_farmer_id != user_id:
            return f"Not your crop. Expected farmer_id={crop_farmer_id}, got user_id={user_id}", 403
        if not winner_user_id:
            return "No winner yet. Wait for auction to close.", 400
        partner_id = winner_user_id
        try:
            bidder = db.users.find_one({"_id": ObjectId(winner_user_id)})
            partner_name = bidder["username"] if bidder else "Winning Bidder"
        except:
            partner_name = "Winning Bidder"
    else:
        return "Invalid role", 403

    print(f"✅ AUTHORIZED - Partner ID: {partner_id}")
    return render_template(
        "chat.html",
        crop_id=crop_id,
        partner_id=partner_id,
        partner_name=partner_name,
        user=user
    )


if __name__ == "__main__":
    app.run(debug=True)

# ------------------ END OF app.py ------------------