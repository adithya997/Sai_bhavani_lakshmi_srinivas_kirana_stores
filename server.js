const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const shell = require('shelljs');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const Order = require('./src/models/Order');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ====================================================================
// AUTOMATED RUNTIME CHROMIUM ENGINE INSTALLATION FOR CLOUD INSTANCES
// ====================================================================
const localCacheDir = '/opt/render/.cache/puppeteer';
console.log("🔍 Checking hosting environment browser path configuration...");

try {
    if (!fs.existsSync(localCacheDir) || fs.readdirSync(localCacheDir).length === 0) {
        console.log("⚠️ Chromium binaries missing from cloud engine cache layers.");
        console.log("🛠️ Initializing background browser engine downloading cycle...");

        // Dynamically run the installation directly from inside Node process
        if (shell.exec('npx puppeteer browsers install chrome').code !== 0) {
            console.error("❌ Programmatic browser component installation encountered an error.");
        } else {
            console.log("🎯 Chromium core binaries downloaded successfully!");
        }
    } else {
        console.log("✅ Cached chromium binary asset layers located safely.");
    }
} catch (err) {
    console.error("⚠️ Runtime file check caution:", err.message);
}

// Fallback logic to check standard paths if the cache layer has moved
const getPuppeteerConfig = () => {
    const config = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    };

    const standardLinuxPaths = [
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium'
    ];

    try {
        if (fs.existsSync(localCacheDir)) {
            const searchForExecutable = (dir) => {
                const elements = fs.readdirSync(dir);
                for (const element of elements) {
                    const fullCombinedPath = path.join(dir, element);
                    if (fs.statSync(fullCombinedPath).isDirectory()) {
                        const potentialMatch = searchForExecutable(fullCombinedPath);
                        if (potentialMatch) return potentialMatch;
                    } else if (element === 'chrome' || element === 'chromium') {
                        return fullCombinedPath;
                    }
                }
                return null;
            };
            const exactLocatedPath = searchForExecutable(localCacheDir);
            if (exactLocatedPath) standardLinuxPaths.unshift(exactLocatedPath);
        }
    } catch (e) {
        console.log("Directory traversal warning:", e.message);
    }

    for (const binaryPath of standardLinuxPaths) {
        if (fs.existsSync(binaryPath)) {
            config.executablePath = binaryPath;
            console.log(`🎯 Targeting engine locked browser path directly at: ${binaryPath}`);
            break;
        }
    }
    return config;
};

// ====================================================================
// DATABASE COUPLING LAYER (Supports MONGO_URI and MONGODB_URI)
// ====================================================================
const targetDatabaseURI = process.env.MONGODB_URI || process.env.MONGO_URI;

if (!targetDatabaseURI) {
    console.error("❌ CRITICAL: No database connection string variable detected on environment state.");
} else {
    mongoose.connect(targetDatabaseURI)
        .then(() => console.log("Connected securely to MongoDB Cluster."))
        .catch(err => console.error("Database connection failure:", err));
}

// ====================================================================
// WHATSAPP INSTANCE INTIALIZATION
// ====================================================================
const whatsappClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: getPuppeteerConfig()
});

whatsappClient.on('qr', (qr) => {
    console.log('\n--- SCAN THE QR CODE BELOW TO CONNECT OWNER LINE ---');
    qrcodeTerminal.generate(qr, { small: true });
});

whatsappClient.on('ready', () => {
    console.log('🚀 WhatsApp Engine Connected and Authenticated!');
});

whatsappClient.initialize();

// ====================================================================
// API ROUTE GATEWAYS
// ====================================================================
app.get('/', (req, res) => res.send('Sai Bhavani Engine Operating Normally.'));

app.post('/api/orders', async (req, res) => {
    try {
        const newOrder = new Order({ ...req.body, status: 'Pending', paymentStatus: 'Unpaid', totalAmount: 0 });
        await newOrder.save();
        return res.status(201).json({ success: true, orderId: newOrder._id });
    } catch (error) { return res.status(500).json({ success: false, error: error.message }); }
});

app.get('/api/admin/orders', async (req, res) => {
    try {
        const allRecords = await Order.find({}).sort({ createdAt: -1 });
        return res.json(allRecords);
    } catch (error) { return res.status(500).json({ success: false, error: error.message }); }
});

app.put('/api/admin/orders/:id/finalize', async (req, res) => {
    try {
        const { itemPrices } = req.body;
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ success: false, message: 'Order reference missing' });

        let grandSum = 0;
        order.items.forEach(item => {
            const counterRatePerUnit = parseFloat(itemPrices[item.productName]) || 0;
            item.price = counterRatePerUnit;
            const standardUnit = item.unit.toLowerCase().trim();
            if (standardUnit === 'gram' || standardUnit === 'gms' || standardUnit === 'ml' || standardUnit === 'mls') {
                item.subtotal = (item.quantity / 1000) * counterRatePerUnit;
            } else {
                item.subtotal = item.quantity * counterRatePerUnit;
            }
            grandSum += item.subtotal;
        });

        order.totalAmount = Math.round(grandSum * 100) / 100;
        order.status = 'Done';
        await order.save();

        let itemsTextSummary = `*Sai Bhavani Kirana Stores*\n\nYour list total amount is: *Rs. ${order.totalAmount.toFixed(2)}*\n`;
        let refinedPhone = order.customer.phone.replace(/\D/g, '');
        if (refinedPhone.length === 10) refinedPhone = '91' + refinedPhone;

        await whatsappClient.sendMessage(`$refinedPhone}@c.us`, itemsTextSummary);
        return res.json({ success: true, order });
    } catch(err) { return res.status(500).json({ success: false, error: err.message }); }
});

app.patch('/api/admin/orders/:id/payment', async (req, res) => {
    try {
        const order = await Order.findByIdAndUpdate(req.params.id, { paymentStatus: req.body.paymentStatus }, { new: true });
        return res.json({ success: true, order });
    } catch(err) { return res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/api/admin/orders/:id', async (req, res) => {
    try {
        await Order.findByIdAndDelete(req.params.id);
        return res.json({ success: true });
    } catch (error) { return res.status(500).json({ success: false, error: error.message }); }
});

const SERVER_PORT = process.env.PORT || 10000;
app.listen(SERVER_PORT, () => console.log(`Express Server instantly bound and listening on Port: ${SERVER_PORT}`));