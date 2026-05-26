const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const P = require('pino');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const Order = require('./src/models/Order');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

let sock = null;
let isWhatsappReady = false;

// ============================================================
// DATABASE CONNECTION
// ============================================================

const targetDatabaseURI = process.env.MONGODB_URI || process.env.MONGO_URI;

mongoose.connect(targetDatabaseURI)
.then(() => {
    console.log('✅ MongoDB Connected Successfully');
})
.catch(err => {
    console.error('❌ MongoDB Connection Error:', err);
});

// ============================================================
// BAILEYS WHATSAPP ENGINE
// ============================================================

async function initializeWhatsApp() {

    try {

        console.log('📦 Initializing Baileys WhatsApp Engine...');

        const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');

        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({
            version,
            auth: state,
            logger: P({ level: 'silent' }),
            browser: ['Sai Bhavani Kirana', 'Chrome', '1.0.0'],
            syncFullHistory: false,
            markOnlineOnConnect: false
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {

            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('📱 QR RECEIVED. Scan from WhatsApp Linked Devices.');
            }

            if (connection === 'open') {
                console.log('🚀 WhatsApp Engine Connected Successfully!');
                isWhatsappReady = true;
            }

            if (connection === 'close') {

                isWhatsappReady = false;

                const shouldReconnect =
                    lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

                console.log('❌ WhatsApp disconnected. Reconnecting:', shouldReconnect);

                if (shouldReconnect) {
                    initializeWhatsApp();
                }
            }
        });

    } catch (err) {

        console.error('❌ WhatsApp Initialization Error:', err);

        setTimeout(() => {
            initializeWhatsApp();
        }, 15000);
    }
}

// ============================================================
// ROUTES
// ============================================================

app.get('/', (req, res) => {
    res.send('Sai Bhavani Engine Operating Normally.');
});

app.get('/health', (req, res) => {
    res.send('alive');
});

// ============================================================
// CREATE ORDER
// ============================================================

app.post('/api/orders', async (req, res) => {

    try {

        const newOrder = new Order({
            ...req.body,
            status: 'Pending',
            paymentStatus: 'Unpaid',
            totalAmount: 0
        });

        await newOrder.save();

        return res.status(201).json({
            success: true,
            orderId: newOrder._id
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// GET ORDERS
// ============================================================

app.get('/api/admin/orders', async (req, res) => {

    try {

        const allRecords = await Order.find({}).sort({ createdAt: -1 });

        return res.json(allRecords);

    } catch (error) {

        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// FINALIZE ORDER + SEND WHATSAPP
// ============================================================

app.put('/api/admin/orders/:id/finalize', async (req, res) => {

    try {

        if (!sock || !isWhatsappReady) {
            return res.status(503).json({
                success: false,
                message: 'WhatsApp engine not connected yet.'
            });
        }

        const { itemPrices } = req.body;

        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order reference missing'
            });
        }

        let grandSum = 0;
        const processedItems = [];

        order.items.forEach(item => {

            const configuredRate = parseFloat(itemPrices[item.productName]);

            item.price = configuredRate;

            let subtotal = 0;

            if (configuredRate !== -1) {

                const standardUnit = item.unit.toLowerCase().trim();

                if (
                    standardUnit === 'gram' ||
                    standardUnit === 'gms' ||
                    standardUnit === 'ml' ||
                    standardUnit === 'mls'
                ) {
                    subtotal = (item.quantity / 1000) * configuredRate;
                } else {
                    subtotal = item.quantity * configuredRate;
                }

                grandSum += subtotal;
            }

            item.subtotal = subtotal;
            processedItems.push(item);
        });

        order.totalAmount = Math.round(grandSum * 100) / 100;
        order.status = 'Done';

        await order.save();

        // ============================================================
        // PDF GENERATION
        // ============================================================

        const tempPdfFileName = `Invoice_${order._id}.pdf`;

        const localTargetPdfPath = path.join(__dirname, tempPdfFileName);

        const doc = new PDFDocument({ margin: 40, size: 'A4' });

        const writeStream = fs.createWriteStream(localTargetPdfPath);

        doc.pipe(writeStream);

        doc.fontSize(18).text('Sai Bhavani Kirana Stores', {
            align: 'center'
        });

        doc.moveDown();

        doc.fontSize(12).text(`Customer: ${order.customer.name}`);
        doc.text(`Phone: ${order.customer.phone}`);

        doc.moveDown();

        processedItems.forEach(item => {

            doc.text(
                `${item.productName} - ${item.quantity} ${item.unit} - Rs.${item.subtotal.toFixed(2)}`
            );
        });

        doc.moveDown();

        doc.fontSize(16).text(`Total: Rs.${order.totalAmount.toFixed(2)}`);

        doc.end();

        await new Promise(resolve => writeStream.on('finish', resolve));

        // ============================================================
        // WHATSAPP SEND
        // ============================================================

        let refinedPhone = order.customer.phone.replace(/\D/g, '');

        if (refinedPhone.length === 10) {
            refinedPhone = '91' + refinedPhone;
        }

        const targetChatId = `${refinedPhone}@s.whatsapp.net`;

        const itemsTextSummary =
            `*Sai Bhavani Kirana Stores*\n\n` +
            `Hello ${order.customer.name},\n` +
            `Your order is ready.\n\n` +
            `💰 Total Amount: Rs.${order.totalAmount.toFixed(2)}\n\n` +
            `Invoice PDF attached below.`;

        console.log('📱 Sending WhatsApp invoice to:', targetChatId);

        await sock.sendMessage(targetChatId, {
            text: itemsTextSummary
        });

        await sock.sendMessage(targetChatId, {
            document: fs.readFileSync(localTargetPdfPath),
            mimetype: 'application/pdf',
            fileName: tempPdfFileName
        });

        // cleanup

        if (fs.existsSync(localTargetPdfPath)) {
            fs.unlinkSync(localTargetPdfPath);
        }

        return res.json({
            success: true,
            order
        });

    } catch (err) {

        console.error(err);

        return res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// ============================================================
// PAYMENT STATUS UPDATE
// ============================================================

app.patch('/api/admin/orders/:id/payment', async (req, res) => {

    try {

        const { paymentStatus } = req.body;

        const order = await Order.findByIdAndUpdate(
            req.params.id,
            { paymentStatus },
            { new: true }
        );

        return res.json({
            success: true,
            order
        });

    } catch (err) {

        return res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// ============================================================
// DELETE ORDER
// ============================================================

app.delete('/api/admin/orders/:id', async (req, res) => {

    try {

        await Order.findByIdAndDelete(req.params.id);

        return res.json({ success: true });

    } catch (error) {

        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// SERVER START
// ============================================================

const SERVER_PORT = process.env.PORT || 10000;

app.listen(SERVER_PORT, () => {

    console.log(`Express Server listening on Port: ${SERVER_PORT}`);

    setTimeout(() => {

        console.log('🚀 Starting Baileys WhatsApp Engine...');

        initializeWhatsApp();

    }, 15000);
});
