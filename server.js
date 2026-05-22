// ====================================================================
// 1. FORCED DNS OVERRIDE FOR WINDOWS NODE.JS RESOLUTION REGRESSION
// ====================================================================
const dns = require('node:dns');
dns.setServers(['1.1.1.1', '8.8.8.8']);

// ====================================================================
// 2. DEPENDENCIES & PROJECT PACKAGE IMPORTS
// ====================================================================
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const shell = require('shelljs');
require('dotenv').config();

// Native WhatsApp Automation Engine Dependencies
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');

const Order = require('./src/models/Order');

// OWNER PHONE DEFINITION ( Srinivas )
const OWNER_WHATSAPP_JID = "919154699599@c.us";

// ====================================================================
// 3. RUNTIME SELF-INSTALLATION FOR CHROMIUM BINARIES
// ====================================================================
const localCacheDir = '/opt/render/.cache/puppeteer';
console.log("🔍 Checking environment browser configuration pathways...");

try {
    if (!fs.existsSync(localCacheDir) || fs.readdirSync(localCacheDir).length === 0) {
        console.log("⚠️ Chromium binaries missing from cloud cache instance layer.");
        console.log("🛠️ Starting native background browser engine installation process...");

        if (shell.exec('npx puppeteer browsers install chrome').code !== 0) {
            console.error("❌ Background browser engine installation encountered an error.");
        } else {
            console.log("🎯 Chromium engine installation completed successfully!");
        }
    } else {
        console.log("✅ Cached chromium binary asset layers located safely.");
    }
} catch (err) {
    console.error("⚠️ Local runtime file analysis warning:", err.message);
}

// Multi-path fallback locator map array to automatically grab the browser binary executable file
const getPuppeteerConfig = () => {
    const config = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote',
            '--single-process'
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
            if (exactLocatedPath) {
                standardLinuxPaths.unshift(exactLocatedPath);
            }
        }
    } catch (e) {
        console.log("Could not traverse caching directory assets dynamically:", e.message);
    }

    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        config.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    } else {
        for (const binaryPath of standardLinuxPaths) {
            if (fs.existsSync(binaryPath)) {
                config.executablePath = binaryPath;
                console.log(`🎯 Targeting engine locked browser pathway directly at: ${binaryPath}`);
                break;
            }
        }
    }
    return config;
};

const whatsappClient = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wwebjs/web-versions/main/remote/2.2412.54.html',
    },
    puppeteer: getPuppeteerConfig()
});

let isWhatsAppReady = false;

whatsappClient.on('qr', (qr) => {
    console.log('\n--- SCAN THE QR CODE BELOW TO CONNECT OWNER LINE ---');
    qrcodeTerminal.generate(qr, { small: true });
});

whatsappClient.on('ready', () => {
    console.log('🚀 WhatsApp Engine Connected and Authenticated!');
    isWhatsAppReady = true;
});

process.on('uncaughtException', (e) => console.error('⚠️ Caught Exception safely:', e.message));
process.on('unhandledRejection', (r) => console.error('⚠️ Caught Rejection safely:', r));

// ====================================================================
// 4. ROUTE GATEWAY EXPRESS CONFIGURATIONS
// ====================================================================
const app = express();
app.use(cors());
app.use(express.json());

// A. CUSTOMER ACTION: Place order and send raw shopping list directly to owner mobile
app.post('/api/orders', async (req, res) => {
    try {
        const { customer, items } = req.body;
        if (!customer || !customer.name || !customer.phone) {
            return res.status(400).json({ success: false, error: "Missing identity properties." });
        }

        const newOrder = new Order({ customer, items, status: 'Pending' });
        await newOrder.save();
        console.log(`📦 New Order Saved in Database: ID ${newOrder._id}`);

        if (isWhatsAppReady) {
            let itemsTextSummary = `🔔 *New Order Received! (#${newOrder._id.toString().slice(-6)})*\n`;
            itemsTextSummary += `👤 *Customer Name:* ${newOrder.customer.name}\n`;
            itemsTextSummary += `📞 *Phone:* ${newOrder.customer.phone}\n`;
            if (newOrder.customer.address) itemsTextSummary += `📍 *Address:* ${newOrder.customer.address}\n`;
            itemsTextSummary += `\n🛒 *GROCERY ITEMS BASKET LIST:*\n`;

            newOrder.items.forEach((item, index) => {
                itemsTextSummary += `${index + 1}. *${item.productName}* — ${item.quantity} ${item.unit}\n`;
                if(item.itemComment) {
                    itemsTextSummary += `   └ 💬 _Option specified:_ "${item.itemComment}"\n`;
                }
            });

            await whatsappClient.sendMessage(OWNER_WHATSAPP_JID, itemsTextSummary);
            console.log(`⚡ Raw collection items list dispatched straight to Owner mobile chat pipeline!`);
        }

        return res.status(201).json({ success: true, orderId: newOrder._id });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// B. ADMIN ACTION: Fetch sorted pipeline records (Pending on top, Done below)
app.get('/api/admin/orders', async (req, res) => {
    try {
        const past24HoursThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const deletionReport = await Order.deleteMany({
            status: 'Done',
            paymentStatus: 'Paid',
            paidAt: { $lte: past24HoursThreshold }
        });
        if(deletionReport.deletedCount > 0) {
            console.log(`🧹 Cleaned up ${deletionReport.deletedCount} historical Paid orders.`);
        }

        const allRecords = await Order.find({});
        allRecords.sort((x, y) => {
            if (x.status === 'Pending' && y.status !== 'Pending') return -1;
            if (x.status !== 'Pending' && y.status === 'Pending') return 1;
            return new Date(y.createdAt) - new Date(x.createdAt);
        });

        return res.json(allRecords);
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// C. ADMIN ACTION: Finalize Pricing, Draw Tabular PDF with Per-Unit Costs
app.put('/api/admin/orders/:id/finalize', async (req, res) => {
    try {
        const { id } = req.params;
        const { itemPrices } = req.body;

        const order = await Order.findById(id);
        if (!order) return res.status(444).json({ success: false, message: 'Order reference entry missing' });

        let grandSum = 0;
        order.items.forEach(item => {
            const counterRatePerUnit = parseFloat(itemPrices[item.productName]) || 0;
            item.price = counterRatePerUnit;

            const standardUnit = item.unit.toLowerCase().trim();
            if (standardUnit === 'gram' || standardUnit === 'gms') {
                item.subtotal = (item.quantity / 1000) * counterRatePerUnit;
            } else if (standardUnit === 'ml' || standardUnit === 'mls') {
                item.subtotal = (item.quantity / 1000) * counterRatePerUnit;
            } else {
                item.subtotal = item.quantity * counterRatePerUnit;
            }
            grandSum += item.subtotal;
        });

        order.totalAmount = Math.round(grandSum * 100) / 100;
        order.status = 'Done';
        await order.save();

        const storeUPI = "9154699599@ybl";
        const titleString = encodeURIComponent("Sai Bhavani Kirana Stores");
        const upiURI = `upi://pay?pa=${storeUPI}&pn=${titleString}&am=${order.totalAmount}&cu=INR`;

        const qrImgPath = path.join(__dirname, `qr_temp_${order._id}.png`);
        await QRCode.toFile(qrImgPath, upiURI, { width: 140, margin: 1 });

        const doc = new PDFDocument({ margin: 40 });
        const pdfName = `Invoice_Receipt_${order._id}.pdf`;
        const localPdfFilePath = path.join(__dirname, pdfName);
        const writeStream = fs.createWriteStream(localPdfFilePath);
        doc.pipe(writeStream);

        doc.fillColor('#047857').fontSize(18).text('SAI BHAVANI KIRANA GENRAL STORES', { align: 'center', bold: true });
        doc.fillColor('#475569').fontSize(11).text('(Battani shop)', { align: 'center' }).moveDown(1.5);

        doc.fillColor('#1e293b').fontSize(9);
        doc.text(`Receipt Reference Token ID: ${order._id.toString().toUpperCase()}`);
        doc.text(`Issued To Customer: ${order.customer.name}`);
        doc.text(`Mobile Contact: ${order.customer.phone}`);
        doc.text(`Timestamp: ${new Date().toLocaleString()}`).moveDown(1.5);

        const tableTopOffset = doc.y;
        doc.font('Helvetica-Bold').fillColor('#ffffff');

        doc.rect(40, tableTopOffset, 530, 20).fill('#047857');
        doc.fillColor('#ffffff');
        doc.text('Particular Item Description', 45, tableTopOffset + 6);
        doc.text('Qty Ordered', 240, tableTopOffset + 6);
        doc.text('Rate per Unit', 340, tableTopOffset + 6);
        doc.text('Total Subtotal', 480, tableTopOffset + 6, { width: 80, align: 'right' });

        let ongoingYOffset = tableTopOffset + 20;
        doc.font('Helvetica').fillColor('#334155');

        order.items.forEach((item, index) => {
            if (index % 2 === 1) {
                doc.rect(40, ongoingYOffset, 530, 20).fill('#f8fafc');
            }
            doc.fillColor('#334155');
            doc.text(item.productName, 45, ongoingYOffset + 6);
            doc.text(`${item.quantity} ${item.unit}`, 240, ongoingYOffset + 6);

            let rawRateLabel = `Rs. ${item.price.toFixed(2)}`;
            if(item.unit === 'gram' || item.unit === 'gms') rawRateLabel = `Rs. ${item.price.toFixed(2)} /kg`;
            if(item.unit === 'ml' || item.unit === 'mls') rawRateLabel = `Rs. ${item.price.toFixed(2)} /ltr`;

            doc.text(rawRateLabel, 340, ongoingYOffset + 6);
            doc.text(`Rs. ${item.subtotal.toFixed(2)}`, 480, ongoingYOffset + 6, { width: 80, align: 'right' });

            ongoingYOffset += 20;

            if(item.itemComment) {
                doc.rect(40, ongoingYOffset, 530, 14).fill('#f0f9ff');
                doc.fillColor('#0369a1').fontSize(8).text(`  ↳ Spec option: "${item.itemComment}"`, 45, ongoingYOffset + 3);
                ongoingYOffset += 14;
                doc.fontSize(9);
            }
        });

        ongoingYOffset += 10;
        doc.rect(40, ongoingYOffset, 530, 2).fill('#e2e8f0');
        ongoingYOffset += 8;
        doc.font('Helvetica-Bold').fillColor('#0f172a').fontSize(12);
        doc.text('Final Settled Bill Amount Value:', 280, ongoingYOffset);
        doc.text(`Rs. ${order.totalAmount.toFixed(2)}`, 480, ongoingYOffset, { width: 80, align: 'right' });

        if (fs.existsSync(qrImgPath)) {
            doc.moveDown(2);
            doc.fontSize(8).fillColor('#64748b').text('Scan QR Code via PhonePe/GPay/BHIM to pay:', { align: 'center' }).moveDown(0.5);
            doc.image(qrImgPath, doc.page.width / 2 - 50, doc.y, { width: 100 });
        }

        doc.end();

        writeStream.on('finish', () => {
            try { if (fs.existsSync(qrImgPath)) fs.unlinkSync(qrImgPath); } catch(err) {}

            let refinedPhone = order.customer.phone.replace(/\D/g, '');
            if (refinedPhone.startsWith('91') && refinedPhone.length > 10) refinedPhone = refinedPhone.substring(2);
            const targetsJID = `91${refinedPhone}@c.us`;

            const welcomeNotificationBody = `Hello ${order.customer.name},\n\nYour grocery list from *Sai Bhavani Kirana Genral Stores (Battani shop)* has been compiled! 🛍️\n\n💰 *Total Amount:* Rs. ${order.totalAmount.toFixed(2)}\n\nYour invoice document file is attached below. Thank you!`;

            setTimeout(async () => {
                if (!isWhatsAppReady) return console.error("WhatsApp transport link down.");
                try {
                    await whatsappClient.sendMessage(targetsJID, welcomeNotificationBody);
                    if (fs.existsSync(localPdfFilePath)) {
                        const fileStringData = fs.readFileSync(localPdfFilePath).toString('base64');
                        const documentObjectMedia = new MessageMedia('application/pdf', fileStringData, `Tax_Receipt_Bill.pdf`);
                        await whatsappClient.sendMessage(targetsJID, documentObjectMedia);
                        try { fs.unlinkSync(localPdfFilePath); } catch(err) {}
                    }
                } catch(waErr) { console.error("Failed to transmit notification:", waErr.message); }
            }, 800);
        });

        return res.json({ success: true, order });
    } catch(err) { return res.status(500).json({ success: false, error: err.message }); }
});

// D. ADMIN ACTION: Toggle Unpaid/Paid status and log timestamp
app.patch('/api/admin/orders/:id/payment', async (req, res) => {
    try {
        const { id } = req.params;
        const { paymentStatus } = req.body;

        const timestampValue = (paymentStatus === 'Paid') ? new Date() : null;
        const order = await Order.findByIdAndUpdate(id, { paymentStatus, paidAt: timestampValue }, { new: true });

        return res.json({ success: true, order });
    } catch(err) { return res.status(500).json({ success: false, error: err.message }); }
});

// E. ADMIN ACTION: Delete an individual order card
app.delete('/api/admin/orders/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await Order.findByIdAndDelete(id);
        return res.json({ success: true, message: "Order removed from database." });
    } catch (error) { return res.status(500).json({ success: false, error: error.message }); }
});

app.get('/', (req, res) => res.send('Sai Bhavani Engine Operating Normally.'));

// ====================================================================
// 5. SERVER INITIALIZATION & DATABASE CONNECTION LAYER
// ====================================================================
const SERVER_PORT = process.env.PORT || 10000;

// Connect to MongoDB and fire up the Express server immediately
// so Render instantly detects the open port and clears the health check.
mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        app.listen(SERVER_PORT, () => {
            console.log(`🎯 Express Server instantly bound and listening on Port: ${SERVER_PORT}`);

            // Now that Render is happy and the port is open,
            // safely trigger the WhatsApp connection sequence in the background.
            console.log("⏳ Initializing WhatsApp client connection pathway...");
            whatsappClient.initialize().catch(err => {
                console.error("Initial handshake bypass warning:", err.message);
            });
        });
    })
    .catch((err) => {
        console.error("❌ MongoDB Database connection failure:", err.message);
    });