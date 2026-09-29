const express = require('express');
const router = express.Router();
const { checkout, getUserOrders } = require('../controllers/orderController');
const { protect } = require('../middleware/authMiddleware');

router.route('/').get(protect, getUserOrders);
router.route('/checkout').post(protect, checkout);

module.exports = router;
