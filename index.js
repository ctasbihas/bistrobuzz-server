const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");
const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("Hello Bangladesh!");
});

const client = new MongoClient(process.env.DB_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

const VerifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ message: "Unauthorize access" });
    }
    const token = authorization.split(" ")[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ message: "Unauthorize access" });
        }
        req.decoded = decoded;
        next();
    });
};

async function run() {
    try {
        await client.connect();
        const db = "bistroBuzz";
        const menuCollection = client.db(db).collection("menu");
        const usersCollection = client.db(db).collection("users");
        const reviewsCollection = client.db(db).collection("reviews");
        const cartCollection = client.db(db).collection("cart");
        const paymentCollection = client.db(db).collection("payments");

        // Secure
        app.post("/jwt", (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
                expiresIn: "1d",
            });
            res.send({ token });
        });
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            if (user.role !== "admin") {
                return res
                    .status(403)
                    .send({ error: true, message: "Forbidden access" });
            }
            next();
        };

        // Menus collection
        app.get("/menu", async (req, res) => {
            const result = await menuCollection.find().toArray();
            res.send(result);
        });
        app.get("/menu/:category", async (req, res) => {
            const category = req.params.category;
            const result = await menuCollection
                .find({
                    category: category,
                })
                .toArray();
            res.send(result);
        });
        app.post("/menu", VerifyJWT, verifyAdmin, async (req, res) => {
            const newMenuFood = req.body;
            const result = await menuCollection.insertOne(newMenuFood);
            res.send(result);
        });
        app.delete("/menu/:id", VerifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await menuCollection.deleteOne(query);
            res.send(result);
        });

        // Users collection
        app.get("/users", VerifyJWT, verifyAdmin, async (req, res) => {
            const users = await usersCollection.find().toArray();
            res.send(users);
        });
        app.post("/users", async (req, res) => {
            const user = req.body;
            const query = { email: user.email };
            const existedUser = await usersCollection.findOne(query);
            if (existedUser) {
                return res.send({ message: "user already exist" });
            }
            const result = await usersCollection.insertOne(user);
            res.send(result);
        });
        app.get("/user/admin/:email", VerifyJWT, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email !== email) {
                res.send({ admin: false });
            }
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            const result = { admin: user?.role === "admin" };
            res.send(result);
        });
        app.patch("/users/admin/:id", async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    role: "admin",
                },
            };
            const result = await usersCollection.updateOne(filter, updatedDoc);
            res.send(result);
        });

        // Reviews collection
        app.get("/reviews", async (req, res) => {
            const result = await reviewsCollection.find().toArray();
            res.send(result);
        });

        // Carts collection
        app.get("/carts", VerifyJWT, async (req, res) => {
            const email = req.query.email;
            if (!email) {
                res.send([]);
            }
            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                return res.status(403).send({ message: "Forbidden access" });
            }
            const query = { email: email };
            const result = await cartCollection.find(query).toArray();
            res.send(result);
        });
        app.post("/carts", async (req, res) => {
            const item = req.body;
            const result = await cartCollection.insertOne(item);
            res.send(result);
        });
        app.delete("/carts/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await cartCollection.deleteOne(query);
            res.send(result);
        });

        // Payment collection
        app.post("/payments", VerifyJWT, async (req, res) => {
            const payment = req.body;
            const insertResult = await paymentCollection.insertOne(payment);

            const query = {
                _id: { $in: payment.cartItems.map((id) => new ObjectId(id)) },
            };
            const deleteResult = await cartCollection.deleteMany(query);

            res.send({ insertResult, deleteResult });
        });
        app.get("/payments", VerifyJWT, async (req, res) => {
            const email = req.query.email;
            if (!email) {
                res.send("Email is required");
            }
            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                return res.status(403).send({ message: "Forbidden access" });
            }
            const query = { email: email };
            const result = await paymentCollection.find(query).toArray();
            res.send(result);
        });

        // Payment Intent
        app.post("/create-payment-intent", VerifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ["card"],
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });

        // Dashboard
        app.get("/admin-stats", VerifyJWT, verifyAdmin, async (req, res) => {
            const customers = await usersCollection.estimatedDocumentCount();
            const products = await menuCollection.estimatedDocumentCount();
            const orders = await paymentCollection.estimatedDocumentCount();
            const payments = await paymentCollection.find().toArray();
            const revenue = payments.reduce(
                (sum, payment) => sum + payment.price,
                0
            );

            res.send({ revenue, customers, products, orders });
        });
        app.get("/order-stats", async (req, res) => {
            const pipeline = [
                {
                    $lookup: {
                        from: "menu",
                        localField: "menuItems",
                        foreignField: "_id",
                        as: "menuItemsData",
                    },
                },
                {
                    $unwind: "$menuItemsData",
                },
                {
                    $group: {
                        _id: "$menuItemsData.category",
                        count: { $sum: 1 },
                        total: { $sum: "$menuItemsData.price" },
                    },
                },
                {
                    $project: {
                        category: "$_id",
                        count: 1,
                        total: { $round: ["$total", 2] },
                        _id: 0,
                    },
                },
            ];

            const result = await paymentCollection
                .aggregate(pipeline)
                .toArray();
            res.send(result);
        });

        // Send Mail
        app.post("/contact", async (req, res) => {
            const { name, email, subject, message } = req.body;

            /* */ let transporter = nodemailer.createTransport({
                host: "smtp.gmail.com",
                port: 587,
                secure: true,
                service: "gmail",
                auth: {
                    user: process.env.EMAIL_USERNAME,
                    pass: process.env.EMAIL_PASSWORD,
                },
            });

            let info = await transporter.sendMail({
                from: `"From ${email}"`,
                to: "tasbihhmd+portfolio@gmail.com",
                sender: email,
                subject: subject + " - " + name + " - " + email,
                text: message,
                html: `<div>${message}</div>`,
            });

            res.json({
                message: "Email sent",
                messageId: info.messageId,
            });
        });

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log(
            "Pinged your deployment. You successfully connected to MongoDB!"
        );
    } finally {
    }
}
run().catch(console.dir);

app.listen(port, () => {
    console.log(`Example app listening on port ${port}!`);
});
