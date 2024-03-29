const express = require('express');
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken')
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
require('dotenv').config();

const formData = require('form-data');
const Mailgun = require('mailgun.js');
const mailgun = new Mailgun(formData);
const mg = mailgun.client({
    username: 'api',
    key: process.env.MAIL_GUN_API_KEY,
});

const { MongoClient, ServerApiVersion, ObjectId, AggregationCursor } = require('mongodb');
const port = process.env.PORT || 5000;


// middleware 
app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.bm0qnz4.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();

        const menuCollection = client.db("bistroDB").collection("menu");
        const reviewCollection = client.db("bistroDB").collection("reviews");
        const cartCollection = client.db("bistroDB").collection("carts");
        const userCollection = client.db("bistroDB").collection("users");
        const paymentCollection = client.db("bistroDB").collection("payments");
        const bookingCollection = client.db("bistroDB").collection("bookings");

        // jwt - API 
        app.post("/jwt", async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ token });
        })

        // middleware - jwt verification
        const verifyToken = (req, res, next) => {
            console.log("inside verify token", req.headers.authorization);
            if (!req.headers.authorization) {
                return res.status(401).send({ message: "unauthorized access" })
            }
            const token = req.headers.authorization.split(' ')[1]

            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: "unauthorized access" });
                }
                req.decoded = decoded;
                next();
            })
        }

        // middelware - use verify admin after getting verifyToken
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isAdmin = (user?.role === "admin");
            if (!isAdmin) {
                return res.status(403).send({ message: "forbidden access" })
            }
            next();
        }

        // user collection - API 
        app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        })

        app.get("/users/admin/:email", verifyToken, async (req, res) => {
            const email = req.params.email;

            if (email !== req.decoded.email) {
                return res.status(403).send({ message: "forbidden access" });
            }

            const query = { email: email };
            const user = await userCollection.findOne(query);

            let admin = false;
            if (user) {
                admin = (user?.role === "admin");
            }
            res.send({ admin });
        })

        app.post("/users", async (req, res) => {
            const user = req.body;

            // insert email if user doesn't exist. 3 ways: {eamil unique, upsert, simple* checking}. and prevent to re-insert existing user.
            const query = { email: user.email };
            const existingUser = await userCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: "user already exist", insertedId: null })
            }

            const result = await userCollection.insertOne(user);
            res.send(result);
        })

        app.patch("/users/admin/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updateUser = {
                $set: {
                    role: "admin"
                }
            }
            const result = await userCollection.updateOne(filter, updateUser);
            res.send(result);
        })

        app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await userCollection.deleteOne(query);
            res.send(result);
        })

        // menu collection - API
        app.get("/menu", async (req, res) => {
            const result = await menuCollection.find().toArray();
            res.send(result);
        })

        app.get("/menu/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await menuCollection.findOne(query);
            res.send(result);
        })

        app.post('/menu', verifyToken, verifyAdmin, async (req, res) => {
            const menuItem = req.body;
            const result = await menuCollection.insertOne(menuItem);
            res.send(result);
        })

        app.patch("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
            const item = req.body;
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updateMenu = {
                $set: {
                    name: item.name,
                    category: item.category,
                    price: item.price,
                    recipe: item.recipe,
                    image: item.image,
                }
            }
            const result = await menuCollection.updateOne(filter, updateMenu);
            res.send(result);
        })

        app.delete('/menu/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await menuCollection.deleteOne(query);
            res.send(result);
        })

        // review collection - API
        app.get("/reviews", async (req, res) => {
            const result = await reviewCollection.find().toArray();
            res.send(result);
        })


        // Users side Dashboard >>>>>>>>>>>>>>>>

        // My cart collection - API
        app.get('/carts', async (req, res) => {
            const email = req.query.email;
            const query = { email: email }
            const result = await cartCollection.find(query).toArray();
            res.send(result);
        })

        app.post('/carts', async (req, res) => {
            const cartItem = req.body;
            const result = await cartCollection.insertOne(cartItem);
            res.send(result);
        })

        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            console.log(query);
            const result = await cartCollection.deleteOne(query);
            res.send(result);
            console.log("cart deleted successfully", result);
        })


        // Payment Intent - API 
        app.post("/create-payment-intent", async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);
            console.log(amount);

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ["card"]
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        })

        // API - to save payment info 
        app.post("/payments", async (req, res) => {
            const payment = req.body;
            const paymentResult = await paymentCollection.insertOne(payment);
            console.log("payment info:", payment);

            // after payment for all items, delete each item from the myCart 
            const query = {
                _id: {
                    $in: payment.cartIds.map(id => new ObjectId(id))
                }
            }
            const deleteResult = await cartCollection.deleteMany(query);

            //send user mail about payment conformation using -Mailgun
            mg.messages
                .create(process.env.MAIL_SENDING_DOMAIN, {
                    from: "Mailgun Sandbox <postmaster@sandbox80754ee3acd545a2baa8f1b5c7985898.mailgun.org>",
                    to: [`dipubarua1997@gmail.com`],//here will be dinamic customar mail id
                    subject: "Bistro Boss Order Conformation",
                    text: "Testing some Mailgun awesomness!",
                    html: `<Div>
                    <h3>Thank you for your order.</h3>
                    <p>You have paid: <strong> ${payment.price} </strong> Tk. successfully.</p>
                    <p>Transaction id: <strong> ${payment.transactionId} </strong></p>
                    <h3>We would like to get your feedback!</h3>
                    </Div>`
                })
                .then(msg => console.log(msg)) // logs response data
                .catch(err => console.log(err)); // logs any error`;


            res.send({ paymentResult, deleteResult });
        })

        // payment history - API 
        app.get("/payments/:email", verifyToken, async (req, res) => {
            const query = { email: req.params.email };

            if (req.params.email !== req.decoded.email) {
                return res.status(403).send({ message: "forbidden access" });
            }

            const result = await paymentCollection.find(query).toArray();
            res.send(result);
        })

        // add Review 
        app.post("/review", async (req, res) => {
            const review = req.body;
            const result = await reviewCollection.insertOne(review);
            res.send(result);
        })

        // user's stats
        app.get("/user-stats/:email", async (req, res) => {
            const userEmail = req.params.email;

            const shop = await paymentCollection.aggregate([
                {
                    $match: { email: `${userEmail}` }
                },
                {
                    $group: {
                        _id: null,
                        quantity: { $sum: 1 },
                    }
                },
            ]).toArray();

            const menus = await paymentCollection.aggregate([
                {
                    $match: { email: `${userEmail}` }
                },
                {
                    $unwind: "$menuItemIds",
                },
                {
                    $group: {
                        _id: null,
                        quantity: { $sum: 1 },
                    }
                }
            ]).toArray();

            const orders = await cartCollection.aggregate([
                {
                    $match: { email: `${userEmail}` }
                },
                {
                    $group: {
                        _id: null,
                        quantity: { $sum: 1 },
                    }
                },
            ]).toArray();

            const reviews = await reviewCollection.aggregate([
                {
                    $match: { email: `${userEmail}` }
                },
                {
                    $group: {
                        _id: null,
                        quantity: { $sum: 1 },
                    }
                },
            ]).toArray();

            const bookings = await bookingCollection.aggregate([
                {
                    $match: { email: `${userEmail}` }
                },
                {
                    $group: {
                        _id: null,
                        quantity: { $sum: 1 },
                    }
                },
            ]).toArray();

            const totalShop = shop.length > 0 ? shop[0].quantity : 0;
            const totalMenus = menus.length > 0 ? menus[0].quantity : 0;
            const totalOrder = orders.length > 0 ? orders[0].quantity : 0;
            const totalReviews = reviews.length > 0 ? reviews[0].quantity : 0;
            const totalbookings = bookings.length > 0 ? bookings[0].quantity : 0;

            res.send({
                totalShop,
                totalMenus,
                totalOrder,
                totalReviews,
                totalbookings
            })
        })


        // Admin side Deshboard >>>>>>>>>>>>> 

        // stats/analytics - API 
        app.get("/admin-stats", verifyToken, verifyAdmin, async (req, res) => {
            const users = await userCollection.estimatedDocumentCount();
            const menuItems = await menuCollection.estimatedDocumentCount();
            const orders = await paymentCollection.estimatedDocumentCount();

            // revenue calculation - not best way,because need to load all data in db
            // const payments = await paymentCollection.find().toArray();
            // const revenue = payments.reduce((total, payment) => total + payment.price, 0)

            // other best way to aggrigate revenue
            const result = await paymentCollection.aggregate([
                {
                    $group: {
                        _id: null, //'null' means groups all documents into a single group for the aggregation.
                        totalRevenue: { $sum: "$price" }
                    }
                }
            ]).toArray();
            const revenue = result.length > 0 ? result[0].totalRevenue : 0;


            // Ex: testing aggrigate revenue with filter:match, limit, sort
            const test = await paymentCollection.aggregate([
                {
                    $match: { status: "pending" }
                },
                { $limit: 5, },
                {
                    $group: {
                        _id: null,
                        total: { $sum: "$price" }
                    }
                },
                { $sort: { total: -1 } },//-1 is descending and 1 is ascendidng order.
            ]).toArray();
            const revFilter = test.length > 0 ? test[0].total : 0;


            res.send({
                users,
                menuItems,
                orders,
                revenue,
                // revFilter
            });
        })


        // API to get ordered items details - using Aggregate pipeline 
        app.get('/order-stats', verifyToken, verifyAdmin, async (req, res) => {
            const result = await paymentCollection.aggregate([
                {
                    $unwind: '$menuItemIds'
                },
                {
                    $lookup: {
                        from: 'menu',
                        localField: 'menuItemIds',
                        foreignField: '_id',
                        as: "menuItems",
                    }
                },
                {
                    $unwind: '$menuItems',
                },
                {
                    $group: {
                        _id: "$menuItems.category",
                        quantity: { $sum: 1 },//cgpt: 1 essentially means that for each document that matches the grouping criteria, it adds 1 to the sum. It's essentially counting the number of documents in each group
                        revenue: { $sum: '$menuItems.price' }
                    }
                },
                {
                    $project: {
                        _id: 0,//0 means doesn't show  _id
                        category: '$_id',
                        quantity: '$quantity',
                        revenue: '$revenue',
                    }
                },
                // {
                //     $sort: { revenue: -1 },
                // }
            ]).toArray();

            return res.send(result);
        })


        // Bookings collection - API

        app.post("/bookings", async (req, res) => {
            const bookingInfo = req.body;
            const result = await bookingCollection.insertOne(bookingInfo);
            res.send(result);
        })

        app.get("/bookings/:email", async (req, res) => {
            const query = { email: req.params.email };
            const myBookings = await bookingCollection.find(query).toArray();
            const totalBookings = await bookingCollection.aggregate([
                {
                    $match: { email: `${req.params.email}` }
                },
                {
                    $group: {
                        _id: null,
                        count: { $sum: 1 },
                    }
                }
            ]).toArray();
            const total = totalBookings.length > 0 ? totalBookings[0].count : 0;

            res.send({ myBookings, total });
        })

        app.delete("/booking/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const deleteBooking = await bookingCollection.deleteOne(query);
            res.send(deleteBooking);
        })
        // admin side bookings api
        app.get("/bookings", async (req, res) => {
            const allBookings = await bookingCollection.find().toArray();
            const totalBookings = await bookingCollection.estimatedDocumentCount();
            console.log(totalBookings);
            res.send({ allBookings, totalBookings });
        })

        app.patch("/booking/:id", verifyToken, verifyAdmin, async (req, res) => {
            const bookingId = req.params.id;
            const filter = { _id: new ObjectId(bookingId) };
            const updateBooking = {
                $set: {
                    status: "Done",
                }
            }
            const result = await bookingCollection.updateOne(filter, updateBooking);
            res.send(result);
        })



        // [***NOTE: You can not run the localhost:5000 with serverside data for the verifyToken security. ]

        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);





app.get('/', (req, res) => {
    res.send("bistro is running");
})

app.listen(port, () => {
    console.log(`Bistro Boss is running on port: ${port}`);
})