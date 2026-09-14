import mongoose from 'mongoose';

const chaosRuleSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    // null means the rule applies to the whole project; set to an endpoint _id to scope it
    endpointId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Endpoint',
      default: null,
      index: true,
    },
    ruleType: {
      type: String,
      required: true,
      enum: [
        'delay',
        'error',
        'rateLimit',
        'authFail',
        'payload',
        'dataSchema',
        'network',
        'availability',
        'consistency',
      ],
    },
    probability: {
      type: Number,
      default: 1.0,
      min: 0,
      max: 1,
    },
    // config: {
    //   type: mongoose.Schema.Types.Mixed,
    //   default: {},
    // },
    isEnabled: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const ChaosRule = mongoose.model('ChaosRule', chaosRuleSchema);

export default ChaosRule;
