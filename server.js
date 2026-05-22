const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const Order = require('./src/models/Order');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("Connected securely to MongoDB Cluster."))
    .catch(err => console.error("Database connection failure:", err));

// Initialize WhatsApp Web Client with Puppeteer configurations for Render
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log('--- SCAN THIS QR CODE WITH WHATSAPP ---');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('WhatsApp Bot Connection Pathway completely initialized!');
});

client.initialize();

// API: Default Verification Endpoint
app.get('/', (req, res) => {
    res.send("Sai Bhavani Engine Operating Normally.");
});

// API: Customers submit new orders
app.post('/api/orders', async (req, res) => {
    try {
        const newOrder = new Order({
            customer: req.body.customer,
            items: req.body.items,
            status: 'Pending',
            paymentStatus: 'Unpaid',
            totalAmount: 0
        });
        await newOrder.save();
        res.status(201).json({ success: true, message: "Order queued up successfully!", orderId: newOrder._id });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// API: Dashboard fetches all live active pipeline records
app.get('/api/admin/orders', async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 });
        res.json(orders);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// API: Owner saves prices and triggers automatic invoice dispatch via WhatsApp
app.put('/api/admin/orders/:id/finalize', async (req, res) => {
    try {
        const { itemPrices } = req.body;
        const order = await Order.findById(req.id || req.params.id);
        if (!order) return res.status(404).json({ success: false, message: "Order record not found" });

        let calculatedTotal = 0;
        order.items.forEach(item => {
            const pricePerUnit = itemPrices[item.productName];
            item.price = pricePerUnit;

            const qty = parseFloat(item.quantity);
            const unit = item.unit.toLowerCase().trim();
            if (unit === 'gram' || unit === 'gms' || unit === 'ml' || unit === 'mls') {
                calculatedTotal += (qty / 1000) * pricePerUnit;
            } else {
                calculatedTotal += qty * pricePerUnit;
            }
        });

        order.totalAmount = calculatedTotal;
        order.status = 'Done';
        await order.save();

        // Compile clean billing message summary
        let messageText = `*Sai Bhavani Kirana Stores*\n\n`;
        messageText += `Hello *${order.customer.name}*, your bill has been generated:\n`;
        order.items.forEach(item => {
            messageText += `- ${item.productName}: ${item.quantity} ${item.unit} @ Rs.${item.price}\n`;
        });
        messageText += `\n*Total Payable Amount: Rs. ${calculatedTotal.toFixed(2)}*\n`;
        messageText += `Status: Awaiting Payment (బాకీ)\n\nThank you for shopping with us! 🙏`;

        // Format and send via WhatsApp
        let formattedPhone = order.customer.phone.replace(/[^\d]/g, '');
        if (!formattedPhone.startsWith('91') && formattedPhone.length === 10) {
            formattedPhone = '91' + formattedPhone;
        }
        formattedPhone += '@c.us';

        await client.sendMessage(formattedPhone, messageText);

        res.json({ success: true, message: "Invoice updated and sent over WhatsApp successfully!" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// API: Toggle status metrics between Paid and Unpaid
app.patch('/api/admin/orders/:id/payment', async (req, res) => {
    try {
        const { paymentStatus } = req.body;
        await Order.findByIdAndUpdate(req.params.id, { paymentStatus });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// API: Delete entries
app.delete('/api/admin/orders/:id', async (req, res) => {
    try {
        await Order.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Express Server instantly bound and listening on Port: ${PORT}`));