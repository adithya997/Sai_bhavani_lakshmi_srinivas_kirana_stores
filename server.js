const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
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
let isInitializing = false;

// ============================================================
// DATABASE CONNECTION
// ============================================================
const targetDatabaseURI = process.env.MONGODB_URI || process.env.MONGO_URI;

mongoose.connect(targetDatabaseURI)
    .then(() => { console.log('✅ MongoDB Connected Successfully'); })
    .catch(err => { console.error('❌ MongoDB Connection Error:', err); });

// ============================================================
// BAILEYS WHATSAPP ENGINE
// ============================================================
async function initializeWhatsApp() {
    if (isInitializing) {
        console.log('⚠️ WhatsApp initialization already running.');
        return;
    }
    isInitializing = true;

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
            markOnlineOnConnect: false,
            printQRInTerminal: false
        });

        sock.ev.on('creds.update', saveCreds);
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`;
                console.log('================================================');
                console.log('📱 OPEN THIS QR LINK IN BROWSER:');
                console.log(qrUrl);
                console.log('================================================');
            }
            if (connection === 'open') {
                console.log('🚀 WhatsApp Engine Connected Successfully!');
                isWhatsappReady = true;
                isInitializing = false;
            }
            if (connection === 'close') {
                isWhatsappReady = false;
                isInitializing = false;
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('❌ WhatsApp disconnected. Reconnecting:', shouldReconnect);
                if (shouldReconnect) {
                    sock = null;
                    setTimeout(() => { initializeWhatsApp(); }, 5000);
                }
            }
        });
    } catch (err) {
        console.error('❌ WhatsApp Initialization Error:', err);
        setTimeout(() => { initializeWhatsApp(); }, 15000);
    }
}

// ============================================================
// ROUTES
// ============================================================
app.get('/', (req, res) => { res.send('Sai Bhavani Engine Operating Normally.'); });
app.get('/health', (req, res) => { res.send('alive'); });

// ============================================================
// CUSTOMER ORDER SUBMISSION -> ALERTS WORKER IMMEDIATELY
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

        // Send instant notification message in Telugu script to the shop worker
        if (sock && isWhatsappReady) {
            const workerMobileNumber = "9154699599";
            const workerChatId = `${workerMobileNumber}@s.whatsapp.net`;

            let workerTeluguMessage = `📋 *కొత్త ప్యాకింగ్ ఆర్డర్ వివరాలు (కొత్త ఆర్డర్ వచ్చింది)*\n`;
            workerTeluguMessage += `----------------------------------------\n`;
            workerTeluguMessage += `👤 *కస్టమర్ పేరు:* ${newOrder.customer.name}\n`;
            workerTeluguMessage += `📞 *ఫోన్ నంబర్:* ${newOrder.customer.phone}\n`;
            workerTeluguMessage += `----------------------------------------\n\n`;
            workerTeluguMessage += `*కావలసిన వస్తువుల జాబితా:*\n`;

            newOrder.items.forEach((item, idx) => {
                workerTeluguMessage += `${idx + 1}. 📦 *${item.productName}* - ${item.quantity} ${item.unit}\n`;
                if (item.itemComment) {
                    workerTeluguMessage += `   💬 _రకం/బ్రాండ్ వివరణ:_ ${item.itemComment}\n`;
                }
            });

            workerTeluguMessage += `\n----------------------------------------\n`;
            workerTeluguMessage += `⚠️ *గమనిక:* యజమాని ఇంకా బిల్లు ఖరారు చేయలేదు. దయచేసి ప్యాకింగ్ సిద్ధం చేయండి.`;

            console.log('📱 Routing instant packing list layout directly to worker:', workerChatId);
            await sock.sendMessage(workerChatId, { text: workerTeluguMessage });
        } else {
            console.log('⚠️ Order saved, but worker WhatsApp message skipped (Engine not ready).');
        }

        return res.status(201).json({ success: true, orderId: newOrder._id });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/admin/orders', async (req, res) => {
    try {
        const allRecords = await Order.find({}).sort({ createdAt: -1 });
        return res.json(allRecords);
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// FINALIZE ORDER + SEND DETAILED TABULAR WHATSAPP INVOICE
// ============================================================
app.put('/api/admin/orders/:id/finalize', async (req, res) => {
    try {
        if (!sock || !isWhatsappReady) {
            return res.status(503).json({ success: false, message: 'WhatsApp engine not connected yet.' });
        }

        const { itemPrices } = req.body;
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order reference missing' });
        }

        let grandSum = 0;
        let totalItemsCount = 0;
        const processedItems = [];

        order.items.forEach(item => {
            const configuredRate = parseFloat(itemPrices[item.productName]);
            item.price = configuredRate;

            let subtotal = 0;
            if (configuredRate !== -1 && !isNaN(configuredRate)) {
                const standardUnit = item.unit.toLowerCase().trim();
                if (['gram', 'gms', 'ml', 'mls'].includes(standardUnit)) {
                    subtotal = (item.quantity / 1000) * configuredRate;
                } else {
                    subtotal = item.quantity * configuredRate;
                }
                grandSum += subtotal;
                totalItemsCount++;
            }

            item.subtotal = subtotal;
            processedItems.push(item);
        });

        order.totalAmount = Math.round(grandSum * 100) / 100;
        order.status = 'Done';
        await order.save();

        // Generate UPI deep link & base64 payment QR Code
        const upiPaymentUri = `upi://pay?pa=8885208886@ybl&pn=Sai%20Bhavani%20Kirana%20Stores&am=${order.totalAmount}&cu=INR&tn=Order_${order._id}`;
        const qrCodeImageBuffer = await QRCode.toBuffer(upiPaymentUri, { margin: 1, width: 130 });

        // ============================================================
        // PROFESSIONAL PDF INVOICE DESIGN
        // ============================================================
        const tempPdfFileName = `Invoice_${order._id}.pdf`;
        const localTargetPdfPath = path.join(__dirname, tempPdfFileName);

        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        const writeStream = fs.createWriteStream(localTargetPdfPath);
        doc.pipe(writeStream);

        // Header Styling Block
        doc.rect(0, 0, 595, 110).fill('#059669');
        doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold').text('Sai Bhavani Lakshmi Srinivasa Kirana Stores', 40, 25, { align: 'center' });
        doc.fontSize(12).font('Helvetica').text('(Battani Shop)', 40, 50, { align: 'center' });
        doc.fontSize(9).text('Nidadavolu, Andhra Pradesh, India | Contact: 9154699599, 8885208886', 40, 70, { align: 'center' });
        doc.text('TAX INVOICE / వస్తువుల ధరల బిల్లు', 40, 88, { align: 'center' });

        // Customer Metadata Block
        doc.fillColor('#1e293b').fontSize(10).font('Helvetica-Bold').text('CUSTOMER DETAILS / వినియోగదారుని వివరాలు', 40, 135);
        doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(40, 148).lineTo(555, 148).stroke();

        doc.font('Helvetica').fontSize(10).fillColor('#475569');
        doc.text(`Name / పేరు: `, 40, 158).font('Helvetica-Bold').fillColor('#1e293b').text(order.customer.name, 120, 158);
        doc.font('Helvetica').fillColor('#475569').text(`WhatsApp No: `, 40, 173).font('Helvetica-Bold').fillColor('#1e293b').text(order.customer.phone, 120, 173);

        doc.font('Helvetica').fillColor('#475569').text(`Invoice Date: `, 380, 158).font('Helvetica-Bold').fillColor('#1e293b').text(new Date().toLocaleDateString('en-IN'), 465, 158);
        doc.font('Helvetica').fillColor('#475569').text(`Status: `, 380, 173).font('Helvetica-Bold').fillColor('#10b981').text('PROCESSED', 465, 173);

        // Tabular Layout Initialization
        let currentY = 205;

        // Table Headers
        doc.rect(40, currentY, 515, 22).fill('#1e293b');
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
        doc.text('Product Description / వస్తువు వివరణ', 45, currentY + 6, { width: 210 });
        doc.text('Qty / పరిమాణం', 260, currentY + 6, { width: 75, align: 'center' });
        doc.text('Unit Cost / ధర', 340, currentY + 6, { width: 95, align: 'right' });
        doc.text('Total / మొత్తం', 445, currentY + 6, { width: 105, align: 'right' });

        currentY += 22;
        doc.font('Helvetica').fontSize(9);

        // Rendering Rows
        processedItems.forEach((item, index) => {
            if (index % 2 === 0) {
                doc.rect(40, currentY, 515, 24).fill('#f8fafc');
            }
            doc.fillColor('#334155');

            let descriptiveLabel = item.productName;
            if (item.itemComment) descriptiveLabel += ` (${item.itemComment})`;

            doc.text(descriptiveLabel, 45, currentY + 7, { width: 210, height: 15, ellipsis: true });
            doc.text(`${item.quantity} ${item.unit}`, 260, currentY + 7, { width: 75, align: 'center' });

            if (item.price === -1) {
                doc.fillColor('#ef4444').font('Helvetica-Bold').text('Not Available / లేదు', 340, currentY + 7, { width: 95, align: 'right' });
                doc.text('Rs. 0.00', 445, currentY + 7, { width: 105, align: 'right' });
            } else {
                doc.font('Helvetica').text(`Rs. ${item.price.toFixed(2)}`, 340, currentY + 7, { width: 95, align: 'right' });
                doc.text(`Rs. ${item.subtotal.toFixed(2)}`, 445, currentY + 7, { width: 105, align: 'right' });
            }

            doc.strokeColor('#f1f5f9').lineWidth(0.5).moveTo(40, currentY + 24).lineTo(555, currentY + 24).stroke();
            currentY += 24;
        });

        // Summary Calculations Box
        currentY += 10;
        doc.rect(300, currentY, 255, 60).fill('#f8fafc');
        doc.strokeColor('#e2e8f0').lineWidth(1).rect(300, currentY, 255, 60).stroke();

        doc.fillColor('#475569').font('Helvetica').fontSize(9);
        doc.text(`Total Available Items / మొత్తం వస్తువులు:`, 310, currentY + 12);
        doc.font('Helvetica-Bold').fillColor('#1e293b').text(`${totalItemsCount}`, 510, currentY + 12, { align: 'right', width: 35 });

        doc.fillColor('#1e293b').fontSize(11).text(`Grand Total / మొత్తం బిల్లు:`, 310, currentY + 36);
        doc.font('Helvetica-Bold').fillColor('#059669').text(`Rs. ${order.totalAmount.toFixed(2)}`, 450, currentY + 36, { align: 'right', width: 95 });

        // Payment Gateway Integration Box
        currentY += 80;
        doc.rect(40, currentY, 515, 145).fill('#f0fdf4');
        doc.strokeColor('#bbf7d0').lineWidth(1).rect(40, currentY, 515, 145).stroke();

        doc.image(qrCodeImageBuffer, 55, currentY + 8, { width: 130, height: 130 });

        let textX = 200;
        doc.fillColor('#166534').font('Helvetica-Bold').fontSize(11).text('DIGITAL PAYMENT / ఆన్‌లైన్ పేమెంట్', textX, currentY + 15);

        doc.fillColor('#334155').font('Helvetica').fontSize(8.5).text('Scan the QR code using any UPI App (PhonePe, GooglePay, Paytm) or click the deep-link connection system configuration layout action directly below.', textX, currentY + 32, { width: 340, lineGap: 2 });
        doc.text('కస్టమర్ గమనిక: పైన ఉన్న QR కోడ్‌ని మీ మొబైల్ లోని GooglePay, PhonePe లేదా Paytm యాప్ ద్వారా స్కాన్ చేసి బిల్లు చెల్లించవచ్చు.', textX, currentY + 62, { width: 340, lineGap: 1 });

        doc.rect(textX, currentY + 98, 200, 28).fill('#059669');
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text('👉 CLICK TO PAY ONLINE 👈', textX + 22, currentY + 107, {
            link: upiPaymentUri,
            underline: false
        });
        doc.fillColor('#166534').font('Helvetica-Oblique').fontSize(8.5).text('Clicking launches available mobile banking configurations directly.', textX, currentY + 130);

        doc.fillColor('#94a3b8').font('Helvetica').fontSize(8).text('Thank you for shopping with us! / మా వద్ద కొనుగోలు చేసినందుకు ధన్యవాదాలు!', 40, 765, { align: 'center' });

        doc.end();
        await new Promise(resolve => writeStream.on('finish', resolve));

        // ============================================================
        // WHATSAPP COMMUNIQUE TRANSMISSION FLOW (TO CUSTOMER)
        // ============================================================
        let refinedPhone = order.customer.phone.replace(/\D/g, '');
        if (refinedPhone.length === 10) refinedPhone = '91' + refinedPhone;
        const targetChatId = `${refinedPhone}@s.whatsapp.net`;

        const itemsTextSummary =
            `*Sai Bhavani Lakshmi Srinivasa Kirana Stores (Battani Shop)*\n\n` +
            `Hello ${order.customer.name},\n` +
            `మీ ఆర్డర్ బిల్లు సిద్ధంగా ఉంది.\n\n` +
            `💰 *Total Bill Amount:* Rs. ${order.totalAmount.toFixed(2)}\n\n` +
            `🔗 *Click here to Pay directly via mobile UPI:* ${upiPaymentUri}\n\n` +
            `Please find your detailed tabular invoice PDF document breakdown attached below.`;

        console.log('📱 Sending WhatsApp invoice to:', targetChatId);

        await sock.sendMessage(targetChatId, { text: itemsTextSummary });
        await sock.sendMessage(targetChatId, {
            document: fs.readFileSync(localTargetPdfPath),
            mimetype: 'application/pdf',
            fileName: tempPdfFileName
        });

        if (fs.existsSync(localTargetPdfPath)) { fs.unlinkSync(localTargetPdfPath); }
        return res.json({ success: true, order });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================
// PAYMENT STATUS UPDATE
// ============================================================
app.patch('/api/admin/orders/:id/payment', async (req, res) => {
    try {
        const { paymentStatus } = req.body;
        const order = await Order.findByIdAndUpdate(req.params.id, { paymentStatus }, { new: true });
        return res.json({ success: true, order });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
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
        return res.status(500).json({ success: false, error: error.message });
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