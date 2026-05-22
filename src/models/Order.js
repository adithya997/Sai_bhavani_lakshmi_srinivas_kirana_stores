const mongoose = require('mongoose');

const OrderItemSchema = new mongoose.Schema({
    productName: { type: String, required: true },
    quantity: { type: Number, required: true },
    unit: { type: String, required: true },
    price: { type: Number, default: 0 },
    subtotal: { type: Number, default: 0 },
    itemComment: { type: String, default: '' } // Added for item brand/type descriptions
});

const OrderSchema = new mongoose.Schema({
    customer: {
        name: { type: String, required: true },
        phone: { type: String, required: true },
        address: { type: String, default: '' },
        deliveryInstructions: { type: String, default: '' }
    },
    items: [OrderItemSchema],
    totalAmount: { type: Number, default: 0 },
    deliveryCharge: { type: Number, default: 0 },
    status: { type: String, default: 'Pending' }, // 'Pending' or 'Done'
    paymentStatus: { type: String, default: 'Unpaid' }, // 'Unpaid' or 'Paid'
    paidAt: { type: Date } // Tracks when payment was completed for the 24-hour automatic purge
}, { timestamps: true });

module.exports = mongoose.model('Order', OrderSchema);