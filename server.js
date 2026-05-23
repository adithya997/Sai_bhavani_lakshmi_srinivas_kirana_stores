const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const shell = require('shelljs');
const PDFDocument = require('pdfkit'); // Core native PDF compiler implementation
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
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
        if (shell.exec('npx puppeteer browsers install chrome').code !== 0) {
            console.error("❌ Programmatic browser component installation encountered an error.");
        } else {
            console.log("🎯 Chromium core binaries downloaded successfully!");
        }
    } else {
        console.log("✅ Cached chromium binaries confirmed.");
    }
} catch (err) {
    console.error("⚠️ Runtime file check caution:", err.message);
}

const getPuppeteerConfig = () => {
    const config = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    };
    const standardLinuxPaths = ['/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
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
    } catch (e) {}

    for (const binaryPath of standardLinuxPaths) {
        if (fs.existsSync(binaryPath)) {
            config.executablePath = binaryPath;
            break;
        }
    }
    return config;
};

// ====================================================================
// DATABASE & WHATSAPP ENGINE INITIALIZATION
// ====================================================================
const targetDatabaseURI = process.env.MONGODB_URI || process.env.MONGO_URI;
if (targetDatabaseURI) {
    mongoose.connect(targetDatabaseURI)
        .then(() => console.log("✅ MongoDB Connected"))
        .catch(err => console.error("❌ MongoDB Connection Error:", err));
}

const whatsappClient = new Client({
    authStrategy: new LocalAuth(),
    authTimeoutMs: 100000,
    puppeteer: getPuppeteerConfig()
});

// Clean clickable QR Code Generation Links
whatsappClient.on('qr', (qr) => {
    console.log("\n=================================================================");
    console.log("✨ WHATSAPP LINK REQUEST GENERATED! COPY THE LINK BELOW: ✨");
    console.log(`https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(qr)}`);
    console.log("=================================================================\n");
});

whatsappClient.on('ready', () => {
    console.log('🚀 WhatsApp Engine Connected Successfully!');
});

// Safe initialization wrapper to intercept 'auth timeout' rejections cleanly
whatsappClient.initialize().catch(err => {
    console.log("\n⚠️ WhatsApp Initialization Paused or Timed Out.");
    console.log(`Reason: ${err.message}. Restarting engine or waiting for next deployment...`);
});

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
        const processedItems = [];

        order.items.forEach(item => {
            const configuredRate = parseFloat(itemPrices[item.productName]);
            item.price = configuredRate;

            let subtotal = 0;
            if (configuredRate !== -1) {
                const standardUnit = item.unit.toLowerCase().trim();
                if (standardUnit === 'gram' || standardUnit === 'gms' || standardUnit === 'ml' || standardUnit === 'mls') {
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

        // UPI and Deep Link parameters
        const upiId = "8885290420@axl";
        const merchantName = encodeURIComponent("Sai Bhavani Kirana Stores");
        const deepLinkUrl = `upi://pay?pa=${upiId}&pn=${merchantName}&am=${order.totalAmount.toFixed(2)}&cu=INR`;
        const phonePeFallbackUrl = `https://phon.pe/pay?pa=${upiId}&pn=${merchantName}&am=${order.totalAmount.toFixed(2)}&cu=INR`;

        // Generate dynamic QR code string matrix via API
        const qrChartUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(deepLinkUrl)}`;

        const tempPdfFileName = `Invoice_${order._id}.pdf`;
        const localTargetPdfPath = path.join(__dirname, tempPdfFileName);

        // ====================================================================
        // MEMORY-SAFE NATIVE PDF GENERATION VIA STREAM BUFFERS
        // ====================================================================
        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        const writeStream = fs.createWriteStream(localTargetPdfPath);
        doc.pipe(writeStream);

        // Check and register font if hosted in Render's file directory (for structural safety)
        const fontPath = path.join(__dirname, '.fonts', 'NotoSansTe.ttf');
        if (fs.existsSync(fontPath)) {
            doc.registerFont('CustomUnicode', fontPath);
            doc.font('CustomUnicode');
        } else {
            doc.font('Helvetica');
        }

        // Invoice Header
        doc.fillColor('#0f172a').fontSize(15).text('Sai Bhavani Lakshmi Srinivasa Kirana Stores (Battani Shop)', { align: 'center' });
        doc.fontSize(10).fillColor('#64748b').text('Tax Invoice / వస్తువుల ధరల బిల్లు', { align: 'center' }).moveDown(1.5);

        // Metadata block configuration
        let currentY = doc.y;
        doc.fillColor('#334155').fontSize(10);
        doc.text(`Customer Name / పేరు: ${order.customer.name}`, 40, currentY);
        doc.text(`Date / తేదీ: ${new Date().toLocaleDateString('en-IN')}`, 380, currentY, { align: 'right', width: 170 });

        doc.text(`Phone / ఫోన్ నంబర్: ${order.customer.phone}`, 40, currentY + 14);
        doc.text(`Status: Packing Completed / ప్యాకింగ్ పూర్తయినది`, 380, currentY + 14, { align: 'right', width: 170 }).moveDown(2);

        // Structural Divider Line
        doc.moveTo(40, doc.y).lineTo(550, doc.y).strokeColor('#cbd5e1').stroke().moveDown(1);

        // Table Header Layout Matrix
        currentY = doc.y;
        doc.fillColor('#475569');
        doc.text('Item Description / వస్తువు', 40, currentY, { width: 220 });
        doc.text('Qty / పరిమాణం', 260, currentY, { width: 90, align: 'center' });
        doc.text('Rate / ధర', 360, currentY, { width: 80, align: 'right' });
        doc.text('Subtotal / మొత్తం', 450, currentY, { width: 100, align: 'right' });
        doc.moveDown(0.5);
        doc.moveTo(40, doc.y).lineTo(550, doc.y).strokeColor('#e2e8f0').stroke().moveDown(0.8);

        // Tabular Items Rendering Engine
        doc.fillColor('#334155');
        processedItems.forEach(item => {
            // Prevent text overflows onto missing target page segments
            if (doc.y > 740) { doc.addPage(); doc.moveTo(40, 40); }

            currentY = doc.y;
            const itemLabel = item.productName;
            const qtyLabel = `${item.quantity} ${item.unit}`;
            const rateLabel = item.price === -1 ? "Not Available" : `Rs. ${item.price.toFixed(2)}`;
            const subtotalLabel = item.price === -1 ? "Rs. 0.00" : `Rs. ${item.subtotal.toFixed(2)}`;

            doc.text(itemLabel, 40, currentY, { width: 220 });
            if (item.itemComment) {
                doc.fontSize(8.5).fillColor('#0284c7').text(`Brand: ${item.itemComment}`, 40, doc.y);
                doc.fontSize(10).fillColor('#334155');
            }

            doc.text(qtyLabel, 260, currentY, { width: 90, align: 'center' });

            if (item.price === -1) doc.fillColor('#dc2626');
            doc.text(rateLabel, 360, currentY, { width: 80, align: 'right' });
            doc.fillColor('#334155');

            doc.text(subtotalLabel, 450, currentY, { width: 100, align: 'right' });

            doc.moveDown(0.8);
            doc.moveTo(40, doc.y).lineTo(550, doc.y).strokeColor('#f1f5f9').stroke().moveDown(0.5);
        });

        doc.moveDown(1);

        // Grand Total Presentation Container
        currentY = doc.y;
        if (currentY > 700) { doc.addPage(); currentY = 40; }
        doc.fillColor('#f8fafc').rect(320, currentY, 230, 45).fillAndStroke('#f8fafc', '#e2e8f0');
        doc.fillColor('#475569').fontSize(9).text('GRAND TOTAL AMOUNT / మొత్తం బిల్లు:', 330, currentY + 8);
        doc.fillColor('#0f172a').fontSize(15).text(`Rs. ${order.totalAmount.toFixed(2)}`, 330, currentY + 22, { bold: true });

        // Instruction Blocks & Static Remote Payment Gateway Assets
        doc.moveDown(3);
        currentY = doc.y;
        if (currentY > 680) { doc.addPage(); currentY = 40; }

        doc.fillColor('#0f172a').fontSize(10).text('Payment Instructions / చెల్లింపు వివరాలు:', 40, currentY);
        doc.fillColor('#475569').fontSize(8.5);
        doc.text('English: Please scan the attached QR code to pay using any active UPI application (PhonePe, GooglePay, Paytm). Alternatively, you can settle this bill at the shop counter during collection.', 40, currentY + 15, { width: 320, lineGap: 2 });
        doc.text('తెలుగు: పక్కన ఉన్న QR కోడ్‌ని స్కాన్ చేసి ఫోన్‌పే, గూగుల్‌పే లేదా పేటీఎం ద్వారా సులభంగా పేమెంట్ చేయవచ్చు. లేదా మీరు వస్తువులను తీసుకునే సమయంలో దుకాణం వద్ద నగదు రూపంలో చెల్లించవచ్చు.', 40, doc.y + 6, { width: 320, lineGap: 2 });
        doc.fillColor('#1e1b4b').text(`UPI ID: ${upiId}`, 40, doc.y + 6, { bold: true });

        // Finalize writing operations to the stream
        doc.end();

        // Lock file thread and monitor output event before initializing WhatsApp delivery pipeline
        await new Promise((resolve) => writeStream.on('finish', resolve));

        // Dispatch text summary text containing structural deep link configurations
        let itemsTextSummary = `*Sai Bhavani Lakshmi Srinivasa Kirana Stores (Battani Shop)*\n\n`;
        itemsTextSummary += `Hello *${order.customer.name}*, your order packing details have been calculated.\n`;
        itemsTextSummary += `💰 Total Bill Amount: *Rs. ${order.totalAmount.toFixed(2)}*\n\n`;
        itemsTextSummary += `🔗 *Pay Instantly via any UPI App / ఇప్పుడే పేమెంట్ చేయడానికి కింద ఉన్న లింక్‌ని క్లిక్ చేయండి:* \n${phonePeFallbackUrl}\n\n`;
        itemsTextSummary += `📥 _Your detailed digital invoice PDF file is attached below with standard per-unit pricing records._`;

        // ====================================================================
        // STABLE, STAGE-SAFE WHATSAPP DELIVERY ENGINE
        // ====================================================================
        // Clean and refine phone structure format safely
        let refinedPhone = order.customer.phone.replace(/\D/g, '');
        if (refinedPhone.length === 10) refinedPhone = '91' + refinedPhone;

        const targetChatId = refinedPhone.includes('@c.us') ? refinedPhone : `${refinedPhone}@c.us`;

        if (fs.existsSync(localTargetPdfPath)) {
            const mediaVectorInstance = MessageMedia.fromFilePath(localTargetPdfPath);

            // CRITICAL SAFEGUARD: Block execution if client runtime properties aren't loaded yet
            if (!whatsappClient || !whatsappClient.info) {
                throw new Error("WhatsApp connection engine is cold-booting. Please wait 10 seconds and try again.");
            }

            await whatsappClient.sendMessage(targetChatId, mediaVectorInstance, { caption: itemsTextSummary });

            // File system resource clean up
            fs.unlinkSync(localTargetPdfPath);
        } else {
            throw new Error("System printed PDF component missing from asset disk layers.");
        }

        return res.json({ success: true, order });
    } catch(err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.patch('/api/admin/orders/:id/payment', async (req, res) => {
    try {
        const { paymentStatus } = req.body;
        const validStatuses = ['Unpaid', 'Paid Online', 'Paid Cash'];
        if (!validStatuses.includes(paymentStatus)) {
            return res.status(400).json({ success: false, error: "Invalid payment metric configuration." });
        }

        const order = await Order.findByIdAndUpdate(
            req.params.id,
            { paymentStatus: paymentStatus },
            { new: true }
        );

        if (!order) return res.status(404).json({ success: false, error: "Order record not found." });
        return res.json({ success: true, order });
    } catch(err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/admin/orders/:id', async (req, res) => {
    try {
        await Order.findByIdAndDelete(req.params.id);
        return res.json({ success: true });
    } catch (error) { return res.status(500).json({ success: false, error: error.message }); }
});

const SERVER_PORT = process.env.PORT || 10000;
app.listen(SERVER_PORT, () => console.log(`Express Server listening on Port: ${SERVER_PORT}`));