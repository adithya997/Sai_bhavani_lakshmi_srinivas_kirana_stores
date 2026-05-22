// 1. FORCED DNS OVERRIDE FOR WINDOWS NODE.JS RESOLUTION REGRESSION
const dns = require('node:dns');
dns.setServers(['1.1.1.1', '8.8.8.8']);

// 2. DEPENDENCIES & PACKAGE IMPORTS
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
require('dotenv').config();

// Native WhatsApp Automation Engine Imports
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');

const Order = require('./src/models/Order');

// 3. INITIALIZE WHATSAPP CLIENT ENGINE WITH STABLE VERSION OVERRIDES
const whatsappClient = new Client({
    authStrategy: new LocalAuth({
        dataPath: path.join(__dirname, '.wwebjs_auth')
    }),
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wwebjs/web-versions/main/remote/2.2412.54.html',
    },
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu'
        ]
    }
});

let isWhatsAppReady = false;

whatsappClient.on('qr', (qr) => {
    console.log('\n--- SCAN THE QR CODE BELOW WITH YOUR WHATSAPP TO LOG IN ---');
    qrcodeTerminal.generate(qr, { small: true });
});

whatsappClient.on('ready', () => {
    console.log('🚀 WhatsApp Engine Connected Natively & Ready!');
    isWhatsAppReady = true;
});

whatsappClient.on('auth_failure', (msg) => {
    console.error('❌ WhatsApp Auth failure:', msg);
    isWhatsAppReady = false;
});

whatsappClient.on('disconnected', () => {
    console.log('❌ WhatsApp Client Disconnected.');
    isWhatsAppReady = false;
});

process.on('uncaughtException', (err) => {
    console.error('⚠️ Intercepted Uncaught Exception safely:', err.message);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Intercepted Unhandled Rejection safely:', reason);
});

whatsappClient.initialize().catch(err => {
    console.error("WhatsApp initialization bypassed:", err.message);
});

// 4. INITIALIZE APP & MIDDLEWARE
const app = express();
app.use(cors());
app.use(express.json());

// --- API ENDPOINTS ---

// A. CUSTOMER ROUTE: Place a New Grocery Order
app.post('/api/orders', async (req, res) => {
    try {
        const { customer, items } = req.body;

        if (!customer || !customer.name || !customer.phone) {
            return res.status(400).json({ success: false, error: "Missing required contact fields." });
        }

        const processedItems = items.map(item => ({
            productName: item.productName,
            quantity: parseFloat(item.quantity) || 1,
            unit: item.unit || 'piece',
            price: 0,
            subtotal: 0
        }));

        const newOrder = new Order({
            customer,
            items: processedItems,
            status: 'Pending'
        });

        await newOrder.save();
        console.log(`📦 Order registered successfully! ID: ${newOrder._id}`);
        return res.status(201).json({ success: true, message: 'Order submitted to store!', orderId: newOrder._id });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// B. ADMIN ROUTE: Fetch live orders
app.get('/api/admin/orders', async (req, res) => {
    try {
        const pendingOrders = await Order.find({ status: 'Pending' }).sort({ createdAt: -1 });
        return res.json(pendingOrders);
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// C. ADMIN ROUTE: Finalize Prices, Generate PDF, and Send via WhatsApp
app.put('/api/admin/orders/:id/finalize', async (req, res) => {
    try {
        const { id } = req.params;
        const { itemPrices } = req.body;

        const order = await Order.findById(id);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        let calculatedTotalAmount = 0;

        order.items.forEach(item => {
            const inputPrice = parseFloat(itemPrices[item.productName]) || 0;
            item.price = inputPrice;

            // Normalized lower-case matching to capture different customer entries safely
            const unitType = item.unit.toLowerCase().trim();

            if (unitType === 'gram' || unitType === 'gms') {
                // Gram to KG conversion rule
                item.subtotal = (item.quantity / 1000) * inputPrice;
            } else if (unitType === 'ml' || unitType === 'mls' || unitType === 'milliliter') {
                // ML to Liter conversion rule
                item.subtotal = (item.quantity / 1000) * inputPrice;
            } else {
                // Direct pricing logic for standard kg, litre, packet, piece strings
                item.subtotal = item.quantity * inputPrice;
            }

            calculatedTotalAmount += item.subtotal;
        });

        order.deliveryCharge = 0;
        order.totalAmount = Math.round(calculatedTotalAmount * 100) / 100;
        order.status = 'Done';
        await order.save();

        // Generate Custom UPI Payment String
        const storeUPI_ID = "8885290420@axl";
        const storeName = encodeURIComponent("Green Cart Grocer");
        const transactionNote = encodeURIComponent(`Order_${order._id}`);
        const upiString = `upi://pay?pa=${storeUPI_ID}&pn=${storeName}&am=${order.totalAmount}&tn=${transactionNote}&cu=INR`;

        // Generate temporary QR image file
        const qrImagePath = path.join(__dirname, `temp_qr_${order._id}.png`);
        await QRCode.toFile(qrImagePath, upiString, { width: 180, margin: 1 });

        // Generate PDF Document
        const doc = new PDFDocument({ margin: 50 });
        const pdfFilename = `Invoice_${order._id}.pdf`;
        const pdfPath = path.join(__dirname, pdfFilename);
        const writeStream = fs.createWriteStream(pdfPath);
        doc.pipe(writeStream);

        // Draw PDF layouts
        doc.fontSize(22).text('GREEN CART GROCER', { align: 'center', underline: true }).moveDown();
        doc.fontSize(10).text(`Invoice ID: ${order._id}`);
        doc.text(`Customer Name: ${order.customer.name}`);
        doc.text(`Phone: ${order.customer.phone}`).moveDown();
        doc.text('---------------------------------------------------------------------------------', { align: 'center' }).moveDown();

        order.items.forEach(item => {
            doc.fontSize(11).text(`${item.productName} (${item.quantity} ${item.unit})`, { continued: true });

            const unitType = item.unit.toLowerCase().trim();

            // Format descriptive lines for the customer receipt printout
            if (unitType === 'gram' || unitType === 'gms') {
                doc.text(` [@ ₹${item.price}/kg] - ₹${item.subtotal.toFixed(2)}`, { align: 'right' });
            } else if (unitType === 'ml' || unitType === 'mls' || unitType === 'milliliter') {
                doc.text(` [@ ₹${item.price}/litre] - ₹${item.subtotal.toFixed(2)}`, { align: 'right' });
            } else {
                doc.text(` - ₹${item.subtotal.toFixed(2)}`, { align: 'right' });
            }
        });

        doc.moveDown();
        doc.text('---------------------------------------------------------------------------------', { align: 'center' }).moveDown();
        doc.fontSize(14).text(`Total Bill Value: ₹${order.totalAmount.toFixed(2)}`, { align: 'right', bold: true }).moveDown(2);

        if (fs.existsSync(qrImagePath)) {
            doc.image(qrImagePath, { fit: [150, 150], align: 'center' });
        }
        doc.end();

        // TRANSMIT DOCUMENT DIRECTLY AFTER STREAM COMPILING COMPLETES
        writeStream.on('finish', () => {
            if (fs.existsSync(qrImagePath)) {
                try { fs.unlinkSync(qrImagePath); } catch(e) {}
            }

            let cleanPhone = order.customer.phone.replace(/\D/g, '');
            if (cleanPhone.startsWith('91') && cleanPhone.length > 10) {
                cleanPhone = cleanPhone.substring(2);
            }
            const whatsappChatId = `91${cleanPhone}@c.us`;

            const textMessageBody = `Hello ${order.customer.name},\n\nYour order from *Green Cart Grocer* is packed and ready for pickup! 🛒\n\n💰 *Total Amount:* ₹${order.totalAmount.toFixed(2)}\n\nYour physical invoice PDF is attached directly below. Thank you!`;

            setTimeout(async () => {
                if (!isWhatsAppReady) {
                    console.error("⚠️ WhatsApp client is offline. Skipping document delivery.");
                    return;
                }
                try {
                    console.log(`\n📬 Delivering physical invoice PDF file attachment to: ${whatsappChatId}`);

                    await whatsappClient.sendMessage(whatsappChatId, textMessageBody);

                    if (fs.existsSync(pdfPath)) {
                        const fileBuffer = fs.readFileSync(pdfPath);
                        const base64Content = fileBuffer.toString('base64');
                        const mediaAttachment = new MessageMedia('application/pdf', base64Content, `Invoice_${order._id}.pdf`);

                        await whatsappClient.sendMessage(whatsappChatId, mediaAttachment);
                        console.log(`✅ File Document Attachment landed safely on client phone window!`);

                        try { fs.unlinkSync(pdfPath); } catch(e) {}
                    }
                } catch (waError) {
                    console.error("❌ Media stream transmission task issue handled safely:", waError.message);
                }
            }, 800);
        });

        return res.json({
            success: true,
            message: 'Order updated to DONE. Invoice file generated with automatic unit conversions.',
            order
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// Root Health Check Route
app.get('/', (req, res) => { res.send('Green Cart Grocer running perfectly!'); });

const PORT = process.env.PORT || 5000;
mongoose.connect(process.env.MONGODB_URI).then(() => {
    app.listen(PORT, () => console.log(`Server executing locally on port ${PORT}`));
});