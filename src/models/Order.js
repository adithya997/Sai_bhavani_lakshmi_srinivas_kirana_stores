const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
    productName: { type: String, required: true },
    quantity: { type: Number, required: true },
    unit: { type: String, required: true },
    price: { type: Number, default: 0 },
    subtotal: { type: Number, default: 0 }
});

const orderSchema = new mongoose.Schema({
    customer: {
        name: { type: String, required: true },
        phone: { type: String, required: true },
        address: { type: String, required: true },
        deliveryInstructions: { type: String }
    },
    items: [orderItemSchema],
    deliveryCharge: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    status: {
        type: String,
        enum: ['Pending', 'Pricing Added', 'Awaiting Payment', 'Payment Confirmed', 'Packing', 'Ready', 'Out for Delivery', 'Delivered', 'Done'],        default: 'Pending'
    }
}, { timestamps: true });



module.exports = mongoose.model('Order', orderSchema);