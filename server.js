const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const shell = require('shelljs');
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
    mongoose.connect(targetDatabaseURI);
}

const whatsappClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: getPuppeteerConfig()
});

whatsappClient.on('qr', (qr) => {
    qrcodeTerminal.generate(qr, { small: true });
});

whatsappClient.on('ready', () => {
    console.log('🚀 WhatsApp Engine Connected Successfully!');
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
        let invoiceRowsHtml = '';

        order.items.forEach(item => {
            const configuredRate = parseFloat(itemPrices[item.productName]);
            item.price = configuredRate;

            let rowRateDisplay = `Rs. ${configuredRate.toFixed(2)}`;
            let rowSubtotal = 0;
            let displaySubtotal = '';

            if (configuredRate === -1) {
                rowRateDisplay = `<span style="color:#dc2626; font-weight:bold;">Not Available</span>`;
                displaySubtotal = 'Rs. 0.00';
                item.subtotal = 0;
            } else {
                const standardUnit = item.unit.toLowerCase().trim();
                if (standardUnit === 'gram' || standardUnit === 'gms' || standardUnit === 'ml' || standardUnit === 'mls') {
                    rowSubtotal = (item.quantity / 1000) * configuredRate;
                } else {
                    rowSubtotal = item.quantity * configuredRate;
                }
                item.subtotal = rowSubtotal;
                grandSum += rowSubtotal;
                displaySubtotal = `Rs. ${rowSubtotal.toFixed(2)}`;
            }

            invoiceRowsHtml += `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 10px; font-size: 12px; color: #334155;">
                        <strong>${item.productName}</strong>
                        ${item.itemComment ? `<br><span style="font-size:10px; color:#0284c7; font-style:italic;">Brand: ${item.itemComment}</span>` : ''}
                    </td>
                    <td style="padding: 10px; font-size: 12px; color: #334155; text-align: center;">${item.quantity} ${item.unit}</td>
                    <td style="padding: 10px; font-size: 12px; color: #334155; text-align: right;">${rowRateDisplay}</td>
                    <td style="padding: 10px; font-size: 12px; color: #1e293b; font-weight: bold; text-align: right;">${displaySubtotal}</td>
                </tr>
            `;
        });

        order.totalAmount = Math.round(grandSum * 100) / 100;
        order.status = 'Done';
        await order.save();

        // UPI and Deep Link parameters
        const upiId = "8885290420@axl";
        const merchantName = encodeURIComponent("Sai Bhavani Kirana Stores");
        const deepLinkUrl = `upi://pay?pa=${upiId}&pn=${merchantName}&am=${order.totalAmount.toFixed(2)}&cu=INR`;
        const phonePeFallbackUrl = `https://phon.pe/pay?pa=${upiId}&pn=${merchantName}&am=${order.totalAmount.toFixed(2)}&cu=INR`;

        // Generate QR code engine source string via standard Google APIs
        const qrChartUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(deepLinkUrl)}`;

        // HTML Markup Template to print into PDF document via Puppeteer
        const fullInvoiceHtmlTemplate = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 30px; color: #334155; background-color: #fff; }
                .header { text-align: center; border-bottom: 3px double #e2e8f0; padding-bottom: 12px; margin-bottom: 20px; }
                .shop-title { font-size: 18px; font-weight: bold; color: #0f172a; margin: 0; }
                .shop-subtitle { font-size: 11px; color: #64748b; font-weight: bold; margin-top: 3px; text-transform: uppercase; }
                .meta-table { width: 100%; margin-bottom: 20px; font-size: 12px; }
                .items-table { width: 100%; border-collapse: collapse; margin-bottom: 25px; }
                .items-table th { background-color: #f1f5f9; color: #475569; font-weight: bold; font-size: 11px; text-transform: uppercase; padding: 10px; border-bottom: 2px solid #cbd5e1; }
                .total-box { float: right; width: 40%; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #f8fafc; padding: 12px; text-align: right; margin-bottom: 20px; }
                .payment-section { clear: both; border: 1px solid #e2e8f0; border-radius: 12px; padding: 15px; background-color: #fff; margin-top: 30px; display: flex; align-items: center; justify-content: space-between; }
                .payment-instructions { font-size: 11px; color: #475569; width: 60%; line-height: 1.6; }
                .qr-container { text-align: center; width: 35%; }
                .qr-img { border: 1px solid #e2e8f0; padding: 4px; border-radius: 6px; }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="shop-title">Sai Bhavani Lakshmi Srinivasa Kirana Stores (Battani Shop)</div>
                <div class="shop-subtitle">Tax Invoice / వస్తువుల ధరల బిల్లు</div>
            </div>

            <table class="meta-table">
                <tr>
                    <td><strong>Customer Name / పేరు:</strong> ${order.customer.name}</td>
                    <td style="text-align: right;"><strong>Date / తేదీ:</strong> ${new Date().toLocaleDateString('en-IN')}</td>
                </tr>
                <tr>
                    <td><strong>Phone / ఫోన్ నంబర్:</strong> ${order.customer.phone}</td>
                    <td style="text-align: right;"><strong>Status:</strong> Packing Completed / ప్యాకింగ్ పూర్తయినది</td>
                </tr>
            </table>

            <table class="items-table">
                <thead>
                    <tr>
                        <th style="text-align: left;">Item Description / వస్తువు</th>
                        <th style="text-align: center;">Qty / పరిమాణం</th>
                        <th style="text-align: right;">Rate per Unit / ధర</th>
                        <th style="text-align: right;">Subtotal / మొత్తం</th>
                    </tr>
                </thead>
                <tbody>
                    ${invoiceRowsHtml}
                </tbody>
            </table>

            <div class="total-box">
                <span style="font-size: 11px; font-weight: bold; color: #64748b; text-transform: uppercase;">Grand Total Amount / మొత్తం బిల్లు:</span><br>
                <span style="font-size: 20px; font-weight: 900; color: #0f172a;">Rs. ${order.totalAmount.toFixed(2)}</span>
            </div>

            <div class="payment-section" style="display: block;">
                <div style="float: left; width: 60%; font-size: 11px; color: #475569; line-height: 1.5;">
                    <h4 style="margin: 0 0 5px 0; color: #0f172a; font-size: 12px;">Payment Instructions / చెల్లింపు వివరాలు:</h4>
                    <p style="margin: 0 0 8px 0;"><strong>English:</strong> Please scan the attached QR code to pay using any active UPI application (PhonePe, GooglePay, Paytm). Alternatively, you can settle this bill at the shop counter during collection.</p>
                    <p style="margin: 0;"><strong>తెలుగు:</strong> పక్కన ఉన్న QR కోడ్‌ని స్కాన్ చేసి ఫోన్‌పే, గూగుల్‌పే లేదా పేటీఎం ద్వారా సులభంగా పేమెంట్ చేయవచ్చు. లేదా మీరు వస్తువులను తీసుకునే సమయంలో దుకాణం వద్ద నగదు రూపంలో చెల్లించవచ్చు.</p>
                    <p style="margin-top: 10px; font-weight: bold; color: #1e1b4b;">UPI ID: ${upiId}</p>
                </div>
                <div style="float: right; width: 35%; text-align: center;">
                    <img src="${qrChartUrl}" class="qr-img" width="120" height="120" alt="Payment QR"><br>
                    <span style="font-size: 10px; font-weight: bold; color: #64748b; display: block; margin-top: 4px;">SCAN & PAY / స్కాన్ చేసి పేమెంట్ చేయండి</span>
                </div>
                <div style="clear: both;"></div>
            </div>
        </body>
        </html>
        `;

        // Compiling HTML payload directly into a raw PDF stream using the running Puppeteer instance
        const browser = whatsappClient.puppeteer;
        const page = await browser.newPage();
        await page.setContent(fullInvoiceHtmlTemplate, { waitUntil: 'networkidle0' });

        const tempPdfFileName = `Invoice_${order._id}.pdf`;
        const localTargetPdfPath = path.join(__dirname, tempPdfFileName);

        await page.pdf({
            path: localTargetPdfPath,
            format: 'A4',
            printBackground: true,
            margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
        });
        await page.close();

        // Dispatch text payload containing PhonePe deep link action handlers
        let itemsTextSummary = `*Sai Bhavani Lakshmi Srinivasa Kirana Stores (Battani Shop)*\n\n`;
        itemsTextSummary += `Hello *${order.customer.name}*, your order packing details have been calculated.\n`;
        itemsTextSummary += `💰 Total Bill Amount: *Rs. ${order.totalAmount.toFixed(2)}*\n\n`;
        itemsTextSummary += `🔗 *Pay Instantly via any UPI App / ఇప్పుడే పేమెంట్ చేయడానికి కింద ఉన్న లింక్‌ని క్లిక్ చేయండి:* \n${phonePeFallbackUrl}\n\n`;
        itemsTextSummary += `📥 _Your detailed digital invoice PDF file is attached below with standard per-unit pricing records._`;

        let refinedPhone = order.customer.phone.replace(/\D/g, '');
        if (refinedPhone.length === 10) refinedPhone = '91' + refinedPhone;

        // Load document from file system and safely transmit via WhatsApp core media buffers
        if (fs.existsSync(localTargetPdfPath)) {
            const mediaVectorInstance = MessageMedia.fromFilePath(localTargetPdfPath);
            await whatsappClient.sendMessage(`${refinedPhone}@c.us`, mediaVectorInstance, { caption: itemsTextSummary });

            // Clean up temporary local system file
            fs.unlinkSync(localTargetPdfPath);
        } else {
            throw new Error("System printed PDF component missing from asset disk layers.");
        }

        // Returns clear success object wrapper to matches dashboard structure perfectly
        return res.json({ success: true, order });
    } catch(err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.patch('/api/admin/orders/:id/payment', async (req, res) => {
    try {
        const { paymentStatus } = req.body;

        // Validation check to accept our new Cash and Online configurations cleanly
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