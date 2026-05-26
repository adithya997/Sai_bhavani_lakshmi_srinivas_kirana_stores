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

                    setTimeout(() => {
                        initializeWhatsApp();
                    }, 5000);
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