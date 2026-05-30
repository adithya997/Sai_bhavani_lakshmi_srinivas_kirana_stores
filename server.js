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
const productDictionary = require('./productDictionary');
const brandDictionary = require('./brandDictionary');
const transliterateToTelugu = require('./transliterator');

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
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`;
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
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
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
app.get('/', (req, res) => { res.send('Sai Bhavani Engine Operating Normally.'); });
app.get('/health', (req, res) => { res.send('alive'); });

function convertProductToTelugu(productName) {
    const normalized = productName.trim().toLowerCase();
    if(productDictionary[normalized]) return productDictionary[normalized];
    return transliterateToTelugu(productName);
}

function convertBrandToTelugu(brandName) {
    if(!brandName) return "";
    const normalized = brandName.trim().toLowerCase();
    if(brandDictionary[normalized]) return brandDictionary[normalized];
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
                const teluguProduct = convertProductToTelugu(item.productName);
                workerTeluguMessage += `${idx + 1}. 📦 *${item.productName} (${teluguProduct})* - ${item.quantity} ${item.unit}\n`;
                if(item.itemComment){
                    const teluguBrand = convertBrandToTelugu(item.itemComment);
                    workerTeluguMessage += `   🏷️ *బ్రాండ్:* ${teluguBrand}\n`;
                }
            });

            workerTeluguMessage += `\n----------------------------------------\n`;
            workerTeluguMessage += `⚠️ *గమనిక:* యజమాని ఇంకా బిల్లు ఖరారు చేయలేదు. దయచేసి ప్యాకింగ్ సిద్ధం చేయండి.`;

            await sock.sendMessage(workerChatId, { text: workerTeluguMessage });
        }
        return res.json({ success: true, order: newOrder });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/admin/orders', async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 });
        return res.json(orders);
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================
// ORDER COMPILATION ENDPOINT
// ============================================================
app.post('/api/admin/orders/:id/compile', async (req, res) => {
    try {
        const { itemPrices, itemComments } = req.body;
        const order = await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({success: false, message: 'Order reference missing'});
        }

        let grandSum = 0;
        let totalItemsCount = 0;

        order.items.forEach(item => {
            item.ownerComment = itemComments[item.productName] || "";
            const configuredRate = Number(itemPrices[item.productName] || 0);

            item.price = configuredRate;
            item.subtotal = configuredRate;

            if (configuredRate !== -1) {
                grandSum += configuredRate;
                totalItemsCount++;
            }
        });

        order.totalAmount = Math.round(grandSum * 100) / 100;
        order.status = 'Done';
        await order.save();

        const params = new URLSearchParams({
            pa: '9154699599@axl',
            pn: 'Sai Bhavani Kirana Stores',
            am: order.totalAmount.toString(),
            cu: 'INR',
            tn: 'KiranaOrder'
        });
        const upiPaymentUri = `upi://pay?${params.toString()}`;
        const qrCodeImageBuffer = await QRCode.toBuffer(upiPaymentUri, {margin: 1, width: 130});

        const tempPdfFileName = `Invoice_${order._id}.pdf`;
        const localTargetPdfPath = path.join(__dirname, tempPdfFileName);
        const doc = new PDFDocument({margin: 40, size: 'A4'});
        const writeStream = fs.createWriteStream(localTargetPdfPath);
        doc.pipe(writeStream);

        doc.rect(0, 0, 595, 110).fill('#059669');
        doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold').text('Sai Bhavani Lakshmi Srinivasa Kirana Stores', 40, 25, {align: 'center'});
        doc.fontSize(12).font('Helvetica').text('(Battani Shop)', 40, 50, {align: 'center'});
        doc.fontSize(9).text('Main Bazaar Road, Near Junction Counter Hub', 40, 70, {align: 'center'});
        doc.text('Phone Mobile Pipeline: +91 9154699599', 40, 85, {align: 'center'});

        doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(11).text('RECIPIENT / INVOICE TO:', 40, 135);
        doc.font('Helvetica').fontSize(10).fillColor('#475569');
        doc.text(`Customer Name: ${order.customer.name}`, 40, 155);
        doc.text(`Phone Channel: ${order.customer.phone}`, 40, 170);

        doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(11).text('BILLING METADATA:', 380, 135);
        doc.font('Helvetica').fontSize(10).fillColor('#475569');
        doc.text(`Order Hash ID: ${order._id.toString().substring(0, 8).toUpperCase()}`, 380, 155);
        doc.text(`Date Logged: ${new Date(order.createdAt).toLocaleDateString('en-IN')}`, 380, 170);

        doc.rect(40, 205, 515, 22).fill('#f1f5f9');
        doc.fillColor('#475569').font('Helvetica-Bold').fontSize(9);
        doc.text('SL.', 48, 212, {width: 25});
        doc.text('PRODUCT SPECIFICATION', 85, 212, {width: 170});
        doc.text('QTY / UNIT', 265, 212, {width: 70});
        doc.text('PRICE RATE', 340, 212, {width: 95, align: 'right'});
        doc.text('SUBTOTAL', 445, 212, {width: 105, align: 'right'});

        let currentY = 227;
        order.items.forEach((item, index) => {
            const isItemUnavailable = item.price === -1;
            doc.fillColor('#1e293b').font('Helvetica').fontSize(9);
            doc.text(`${index + 1}`, 48, currentY + 7, {width: 25});
            doc.font('Helvetica-Bold').text(item.productName, 85, currentY + 7, {width: 170});

            doc.font('Helvetica').fillColor('#475569').text(`${item.quantity} ${item.unit}`, 265, currentY + 7, {width: 70});

            if (isItemUnavailable) {
                doc.font('Helvetica-Bold').fillColor('#ef4444').text('NOT AVAILABLE', 340, currentY + 7, { width: 95, align: 'right' });
                doc.text('₹ 0.00', 445, currentY + 7, {width: 105, align: 'right'});
            } else {
                doc.font('Helvetica').text(`Rs. ${item.price.toFixed(2)}`, 340, currentY + 7, { width: 95, align: 'right' });
                doc.text(`Rs. ${item.subtotal.toFixed(2)}`, 445, currentY + 7, {width: 105, align: 'right'});
            }

            currentY += 24;

            if (item.ownerComment) {
                doc.fontSize(8).fillColor('#64748b').font('Helvetica-Oblique');
                doc.text(`Note: ${item.ownerComment}`, 85, currentY);
                currentY += 14;
            }

            doc.strokeColor('#f1f5f9').lineWidth(0.5).moveTo(40, currentY).lineTo(555, currentY).stroke();
        });

        currentY += 10;
        doc.rect(300, currentY, 255, 60).fill('#f8fafc');
        doc.strokeColor('#e2e8f0').lineWidth(1).rect(300, currentY, 255, 60).stroke();

        doc.fillColor('#475569').font('Helvetica').fontSize(9);
        doc.text(`Total Available Items:`, 310, currentY + 12);
        doc.font('Helvetica-Bold').fillColor('#1e293b').text(`${totalItemsCount}`, 510, currentY + 12, { align: 'right', width: 35 });

        doc.font('Helvetica-Bold').fillColor('#059669').fontSize(11);
        doc.text(`Grand Total Amount:`, 310, currentY + 35);
        doc.text(`Rs. ${order.totalAmount.toFixed(2)}`, 440, currentY + 35, {align: 'right', width: 105});

        if (currentY < 650) {
            doc.strokeColor('#cbd5e1').lineWidth(1).dashed(4, {space: 2}).moveTo(40, currentY + 80).lineTo(555, currentY + 80).stroke();

            let paymentSectionY = currentY + 95;
            doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(11).text('SCAN QR CODE TO PAY IMMEDIATELY via UPI:', 40, paymentSectionY);
            doc.image(qrCodeImageBuffer, 40, paymentSectionY + 15);

            doc.fontSize(10).font('Helvetica-Bold').fillColor('#059669').text('Sai Bhavani General Stores Hub Interfacing', 190, paymentSectionY + 25);
            doc.font('Helvetica').fontSize(8).fillColor('#64748b').text('✨ Fast, secure, and powered by unified instant payment infrastructures.', 190, paymentSectionY + 40);
            doc.text(`Deep Integration Link String: ${upiPaymentUri.substring(0, 60)}...`, 190, paymentSectionY + 55, {width: 360});
        }

        doc.end();

        // Promise to structure flow cleanly and guarantee execution order
        await new Promise((resolve, reject) => {
            writeStream.on('finish', async () => {
                try {
                    if (sock && isWhatsappReady) {
                        const customerFormattedChatId = `${order.customer.phone.trim()}@s.whatsapp.net`;

                        let customerAlertString = `🙏 *సాయి భవానీ కిరాణా స్టోర్స్ (బఠానీ షాప్) నుండి బిల్లు*\n`;
                        customerAlertString += `--------------------------------------------------\n`;
                        customerAlertString += `👤 *కస్టమర్ పేరు:* ${order.customer.name}\n`;
                        customerAlertString += `Invoice Total: *₹${order.totalAmount}*\n\n`;
                        customerAlertString += `💳 *Payment Options*\n\n`;
                        customerAlertString += `*UPI ID:*\n9154699599@axl\n\n`;
                        customerAlertString += `*PhonePe Number:*\n9154699599\n\n`;
                        customerAlertString += `*Google Pay Number:*\n9154699599\n\n`;
                        customerAlertString += `*Paytm Number:*\n9154699599\n\n`;
                        customerAlertString += `Invoice PDF attached.\n`;
                        customerAlertString += `--------------------------------------------------\n`;
                        customerAlertString += `మీ ఆర్డర్ సిద్ధంగా ఉంది! దయచేసి పైన పేర్కొన్న నంబర్‌కు పేమెంట్ చేసి, స్క్రీన్‌షాట్ పంపగలరు. ధన్యవాదాలు!`;

                        await sock.sendMessage(customerFormattedChatId, { text: customerAlertString });

                        await sock.sendMessage(customerFormattedChatId, {
                            document: fs.readFileSync(localTargetPdfPath),
                            mimetype: 'application/pdf',
                            fileName: `Sai_Bhavani_Invoice_${order._id.toString().substring(0,6).toUpperCase()}.pdf`
                        });
                    }
                    resolve();
                } catch (whatsappErr) {
                    // Log WhatsApp dispatch failures safely without blocking API response
                    console.error("⚠️ WhatsApp Message transmission error:", whatsappErr);
                    resolve();
                } finally {
                    try {
                        if (fs.existsSync(localTargetPdfPath)) {
                            fs.unlinkSync(localTargetPdfPath);
                        }
                    } catch(err){
                        console.error("⚠️ Local file cleanup error:", err);
                    }
                }
            });

            writeStream.on('error', (streamErr) => {
                reject(streamErr);
            });
        });

        return res.json({success: true, order});
    } catch (err) {
        console.error("❌ Order compilation exception encountered:", err);
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
        initializeWhatsApp().catch(e => console.error("Initial Baileys Boot error:", e));
    }, 5000);
});