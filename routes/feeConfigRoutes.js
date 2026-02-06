import express from "express";
import {
  updateFeeConfig,
  getFeeConfig,
    getFeeConfigById,
  deleteFeeConfig
} from "../controllers/feeConfigController.js";

const router = express.Router();

router.get("/get", getFeeConfig);
router.put("/update", updateFeeConfig);
router.get("/get/:id", getFeeConfigById);
router.delete("/delete/:id", deleteFeeConfig);


export default router;