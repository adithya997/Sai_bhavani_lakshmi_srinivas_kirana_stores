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
const productDictionary =
    require('./productDictionary');

const brandDictionary =
    require('./brandDictionary');

const transliterateToTelugu =
    require('./transliterator');

const app = express();
app.use(cors());
app.use(express.json());

let sock = null;
let isWhatsappReady = false;
let isInitializing = false;
let reconnectTimeout = null;
let qrGenerated = false;

setInterval(async () => {

    try {

        if (sock && isWhatsappReady) {

            await sock.sendPresenceUpdate('available');

            console.log('💓 WhatsApp keep alive ping');
        }

    } catch (err) {

        console.log('⚠️ Keep alive failed');
    }

}, 180000);
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
    if (isInitializing) {
        console.log('⚠️ WhatsApp initialization already running.');
        return;
    }
    isInitializing = true;

    try {
        console.log('📦 Initializing Baileys WhatsApp Engine...');
        const {state, saveCreds} = await useMultiFileAuthState('./auth_info_baileys');
        const {version} = await fetchLatestBaileysVersion();

        if (sock) {
            try {
                sock.end();
            } catch (e) {
            }
        }

        sock = makeWASocket({
            version,
            auth: state,
            logger: P({level: 'silent'}),
            browser: ['Sai Bhavani Kirana', 'Chrome', '1.0.0'],
            syncFullHistory: false,
            markOnlineOnConnect: false,
            printQRInTerminal: false
        });

        sock.ev.on('creds.update', saveCreds);
        sock.ev.on('connection.update', async (update) => {
            const {connection, lastDisconnect, qr} = update;
            if (qr && !qrGenerated) {

                qrGenerated = true;

                const qrUrl =
                    `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`;

                console.log('================================================');
                console.log('📱 OPEN THIS QR LINK IN BROWSER:');
                console.log(qrUrl);
                console.log('================================================');
            }
            if (connection === 'open') {
                console.log('🚀 WhatsApp Engine Connected Successfully!');
                isInitializing = false;
                isWhatsappReady = true;
                qrGenerated = false;
                if (reconnectTimeout) {
                    clearTimeout(reconnectTimeout);
                }
            }
            if (connection === 'close') {

                isWhatsappReady = false;
                isInitializing = false;
                qrGenerated = false;

                const shouldReconnect =
                    lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

                console.log('❌ WhatsApp disconnected. Reconnecting:', shouldReconnect);

                if (shouldReconnect && !reconnectTimeout) {

                    reconnectTimeout = setTimeout(async () => {

                        reconnectTimeout = null;
                        sock = null;

                        await initializeWhatsApp();

                    }, 10000);
                }
            }
        });
    } catch (err) {

        isInitializing = false;
        qrGenerated = false;

        console.error('❌ WhatsApp Initialization Error:', err);

        if (!reconnectTimeout) {

            reconnectTimeout = setTimeout(async () => {

                reconnectTimeout = null;

                await initializeWhatsApp();

            }, 15000);
        }
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
// CUSTOMER ORDER SUBMISSION -> ALERTS WORKER IMMEDIATELY
// ============================================================

function convertProductToTelugu(productName) {

    const normalized =
        productName
            .trim()
            .toLowerCase();

    if(productDictionary[normalized]) {
        return productDictionary[normalized];
    }

    return transliterateToTelugu(productName);
}

function convertBrandToTelugu(brandName) {

    if(!brandName) return "";

    const normalized =
        brandName
            .trim()
            .toLowerCase();

    if(brandDictionary[normalized]) {
        return brandDictionary[normalized];
    }

    return transliterateToTelugu(brandName);
}


app.post('/api/orders', async (req, res) => {
    try {
        const newOrder = new Order({
            ...req.body,
            status: 'Pending',
            paymentStatus: 'Unpaid',
            totalAmount: 0
        });
        await newOrder.save();

        // Send instant packing notification in Telugu script to the shop worker
        if (sock && isWhatsappReady) {
            const workerMobileNumber = "919154699599";
            const workerChatId = `${workerMobileNumber}@s.whatsapp.net`;

            let workerTeluguMessage = `📋 *కొత్త ప్యాకింగ్ ఆర్డర్ వివరాలు (కొత్త ఆర్డర్ వచ్చింది)*\n`;
            workerTeluguMessage += `----------------------------------------\n`;
            workerTeluguMessage += `👤 *కస్టమర్ పేరు:* ${newOrder.customer.name}\n`;
            workerTeluguMessage += `📞 *ఫోన్ నంబర్:* ${newOrder.customer.phone}\n`;
            workerTeluguMessage += `----------------------------------------\n\n`;
            workerTeluguMessage += `*కావలసిన వస్తువుల జాబితా:*\n`;

            newOrder.items.forEach((item, idx) => {
                const teluguProduct =
                    convertProductToTelugu(
                        item.productName
                    );

                workerTeluguMessage +=
                    `${idx + 1}. 📦 *${item.productName} (${teluguProduct})* - ${item.quantity} ${item.unit}\n`;
                if(item.itemComment){

                    const teluguBrand =
                        convertBrandToTelugu(
                            item.itemComment
                        );

                    workerTeluguMessage +=
                        `   🏷️ *బ్రాండ్:* ${teluguBrand}\n`;
                }
            });

            workerTeluguMessage += `\n----------------------------------------\n`;
            workerTeluguMessage += `⚠️ *గమనిక:* యజమాని ఇంకా బిల్లు ఖరారు చేయలేదు. దయచేసి ప్యాకింగ్ సిద్ధం చేయండి.`;

            console.log('📱 Routing instant packing list layout directly to worker:', workerChatId);
            setImmediate(async () => {
                try {
                    if (sock && isWhatsappReady) {
                        await sock.sendMessage(workerChatId, {
                            text: workerTeluguMessage
                        });
                    }
                } catch (err) {
                    console.error('Worker message failed:', err);
                }
            });        } else {
            console.log('⚠️ Order saved, but worker WhatsApp message skipped (Engine not ready).');
        }

        return res.status(201).json({success: true, orderId: newOrder._id});
    } catch (error) {
        return res.status(500).json({success: false, error: error.message});
    }
});

app.get('/api/admin/orders', async (req, res) => {
    try {
        const allRecords = await Order.find({}).sort({createdAt: -1});
        return res.json(allRecords);
    } catch (error) {
        return res.status(500).json({success: false, error: error.message});
    }
});

// ============================================================
// FINALIZE ORDER + SEND INVOICE PDF (ENGLISH ONLY + UPI PAY LINK)
// ============================================================
app.put('/api/admin/orders/:id/finalize', async (req, res) => {
    try {
        if (!sock || !isWhatsappReady) {
            return res.status(503).json({success: false, message: 'WhatsApp engine not connected yet.'});
        }

        const {itemPrices} = req.body;
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({success: false, message: 'Order reference missing'});
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
                    subtotal = configuredRate;                }
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
        const params = new URLSearchParams({
            pa: '9154699599@axl',
            pn: 'Sai Bhavani Kirana Stores',
            am: order.totalAmount.toString(),
            cu: 'INR',
            tn: 'KiranaOrder'
        });

        const upiPaymentUri = `upi://pay?${params.toString()}`;
        const qrCodeImageBuffer = await QRCode.toBuffer(upiPaymentUri, {margin: 1, width: 130});

        // ============================================================
        // ENGLISH-ONLY PROFESSIONAL PDF INVOICE DESIGN
        // ============================================================
        const tempPdfFileName = `Invoice_${order._id}.pdf`;
        const localTargetPdfPath = path.join(__dirname, tempPdfFileName);

        const doc = new PDFDocument({margin: 40, size: 'A4'});
        const writeStream = fs.createWriteStream(localTargetPdfPath);
        doc.pipe(writeStream);

        // Header Styling Block
        doc.rect(0, 0, 595, 110).fill('#059669');
        doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold').text('Sai Bhavani Lakshmi Srinivasa Kirana Stores', 40, 25, {align: 'center'});
        doc.fontSize(12).font('Helvetica').text('(Battani Shop)', 40, 50, {align: 'center'});
        doc.fontSize(9).text('Nidadavolu, Andhra Pradesh, India | Contact: 9154699599, 8885208886', 40, 70, {align: 'center'});
        doc.fontSize(11).font('Helvetica-Bold').text('TAX INVOICE', 40, 88, {align: 'center'});

        // Customer Metadata Block
        doc.fillColor('#1e293b').fontSize(10).font('Helvetica-Bold').text('CUSTOMER DETAILS', 40, 135);
        doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(40, 148).lineTo(555, 148).stroke();

        doc.font('Helvetica').fontSize(10).fillColor('#475569');
        doc.text(`Customer Name: `, 40, 158).font('Helvetica-Bold').fillColor('#1e293b').text(order.customer.name, 125, 158);
        doc.font('Helvetica').fillColor('#475569').text(`WhatsApp No: `, 40, 173).font('Helvetica-Bold').fillColor('#1e293b').text(order.customer.phone, 125, 173);

        doc.font('Helvetica').fillColor('#475569').text(`Invoice Date: `, 380, 158).font('Helvetica-Bold').fillColor('#1e293b').text(new Date().toLocaleDateString('en-IN'), 465, 158);
        doc.font('Helvetica').fillColor('#475569').text(`Status: `, 380, 173).font('Helvetica-Bold').fillColor('#10b981').text('PROCESSED', 465, 173);

        // Tabular Layout Initialization
        let currentY = 205;

        // Table Headers
        doc.rect(40, currentY, 515, 22).fill('#1e293b');
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
        doc.text('Product Description', 45, currentY + 6, {width: 210});
        doc.text('Qty / Unit', 260, currentY + 6, {width: 75, align: 'center'});
        doc.text('Unit Cost', 340, currentY + 6, {width: 95, align: 'right'});
        doc.text('Total Amount', 445, currentY + 6, {width: 105, align: 'right'});

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

            doc.text(descriptiveLabel, 45, currentY + 7, {width: 210, height: 15, ellipsis: true});
            doc.text(`${item.quantity} ${item.unit}`, 260, currentY + 7, {width: 75, align: 'center'});

            if (item.price === -1) {
                doc.fillColor('#ef4444').font('Helvetica-Bold').text('Out of Stock', 340, currentY + 7, {
                    width: 95,
                    align: 'right'
                });
                doc.text('Rs. 0.00', 445, currentY + 7, {width: 105, align: 'right'});
            } else {
                doc.font('Helvetica').text(`Rs. ${item.price.toFixed(2)}`, 340, currentY + 7, {
                    width: 95,
                    align: 'right'
                });
                doc.text(`Rs. ${item.subtotal.toFixed(2)}`, 445, currentY + 7, {width: 105, align: 'right'});
            }

            doc.strokeColor('#f1f5f9').lineWidth(0.5).moveTo(40, currentY + 24).lineTo(555, currentY + 24).stroke();
            currentY += 24;
        });

        // Summary Calculations Box
        currentY += 10;
        doc.rect(300, currentY, 255, 60).fill('#f8fafc');
        doc.strokeColor('#e2e8f0').lineWidth(1).rect(300, currentY, 255, 60).stroke();

        doc.fillColor('#475569').font('Helvetica').fontSize(9);
        doc.text(`Total Available Items:`, 310, currentY + 12);
        doc.font('Helvetica-Bold').fillColor('#1e293b').text(`${totalItemsCount}`, 510, currentY + 12, {
            align: 'right',
            width: 35
        });

        doc.fillColor('#1e293b').fontSize(11).text(`Grand Total:`, 310, currentY + 36);
        doc.font('Helvetica-Bold').fillColor('#059669').text(`Rs. ${order.totalAmount.toFixed(2)}`, 450, currentY + 36, {
            align: 'right',
            width: 95
        });

        // Payment Gateway Integration Box (QR + Link Option Inside PDF)
        currentY += 80;
        doc.rect(40, currentY, 515, 145).fill('#f0fdf4');
        doc.strokeColor('#bbf7d0').lineWidth(1).rect(40, currentY, 515, 145).stroke();

        // Embed Rendered QR Code
        doc.image(qrCodeImageBuffer, 55, currentY + 8, {width: 130, height: 130});

        // English Payment Instructions
        let textX = 200;
        doc.fillColor('#166534').font('Helvetica-Bold').fontSize(11).text('DIGITAL PAYMENT / UPI GATEWAY', textX, currentY + 15);
        doc.fillColor('#334155').font('Helvetica').fontSize(8.5).text('Option 1: Scan the QR code image on the left using your mobile phone camera or any banking application (Google Pay, PhonePe, Paytm, BHIM) to pay instantly.', textX, currentY + 32, {
            width: 340,
            lineGap: 2
        });
        doc.text('Option 2: If viewing this PDF document directly on your smartphone device, click the interactive green button block built below to pay without scanning.', textX, currentY + 68, {
            width: 340,
            lineGap: 1
        });

        // Clickable Button built directly into the PDF
        doc.rect(textX, currentY + 102, 200, 26).fill('#059669');
        doc.fillColor('blue')
            .text('Pay Now', {
                link: upiPaymentUri,
                underline: true
            });

        // Footer block notice
        doc.fillColor('#94a3b8').font('Helvetica').fontSize(8).text('Thank you for shopping with us!', 40, 765, {align: 'center'});

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
            `Please find your detailed English invoice PDF document attached below.`;

        console.log('📱 Sending WhatsApp invoice to:', targetChatId);

        await sock.sendMessage(targetChatId, {text: itemsTextSummary});
        await sock.sendMessage(targetChatId, {
            document: fs.readFileSync(localTargetPdfPath),
            mimetype: 'application/pdf',
            fileName: tempPdfFileName
        });

        if (fs.existsSync(localTargetPdfPath)) {
            fs.unlinkSync(localTargetPdfPath);
        }
        return res.json({success: true, order});

    } catch (err) {
        console.error(err);
        return res.status(500).json({success: false, error: err.message});
    }
});

// ============================================================
// PAYMENT STATUS UPDATE
// ============================================================
app.patch('/api/admin/orders/:id/payment', async (req, res) => {
    try {
        const {paymentStatus} = req.body;
        const order = await Order.findByIdAndUpdate(req.params.id, {paymentStatus}, {new: true});
        return res.json({success: true, order});
    } catch (err) {
        return res.status(500).json({success: false, error: err.message});
    }
});

// ============================================================
// DELETE ORDER
// ============================================================
app.delete('/api/admin/orders/:id', async (req, res) => {
    try {
        await Order.findByIdAndDelete(req.params.id);
        return res.json({success: true});
    } catch (error) {
        return res.status(500).json({success: false, error: error.message});
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