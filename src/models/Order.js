const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
    customer: {
        name: { type: String, required: true },
        phone: { type: String, required: true }
    },
    items: [{
        productName: { type: String, required: true },
        quantity: { type: Number, required: true },
        unit: { type: String, required: true },
        itemComment: { type: String, default: "" },
        price: { type: Number, default: 0 }
    }],
    status: { type: String, enum: ['Pending', 'Done'], default: 'Pending' },
    // Updated enum to support all three payment states seamlessly
    paymentStatus: { type: String, enum: ['Unpaid', 'Paid Online', 'Paid Cash'], default: 'Unpaid' },
    totalAmount: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Order', OrderSchema);