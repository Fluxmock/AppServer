import mongoose from 'mongoose';

export const RULE_TYPE = [
       'delay',
        'error',
        'rateLimit',
        'authFail',
        'payload',
        'dataSchema',
        'network',
        'availability',
        'consistency',
]

const chaosRuleSchema = new mongoose.Schema({
   ruleType : {
    type : String,
    required : true,
    enum : RULE_TYPE
   },
   probability : {
    type : Number,
    default : 1.0,
    min : 0,
    max : 1
   },
   config : {
    type : mongoose.Schema.Types.Mixed,
    default : {}
   },
   isEnabled : {
    type : Boolean,
    default : true
   }
},
{
    _id : true, timestamps : true
   });

   const chaosRuleSetSchema = new mongoose.Schema( 
    {
      projectId : {
        type : mongoose.Schema.Types.ObjectId,
        ref : 'Project',
        required : true,
        index : true,
      },
      endpointId : {
        type : mongoose.Schema.Types.ObjectId,
        ref : 'Endpoint',
        default : null,
      },
      rules : {
        type : [chaosRuleSchema],
        default : []
      }
    },
    { timestamps : true}
   );

   //one rule set document per scope
   chaosRuleSetSchema.index(
    {
      projectId : 1,
      endpointId : 1,
    },
    {unique : true}
   );

   //ruleType unique within a set
   chaosRuleSetSchema.pre('validate', function(next){
    const seen = new Set();
    for(const r of this.rules){
      if(seen.has(r.ruleType)){
        return next(new Error(`Duplicate ruletype "${r.ruleType}" in this scope`))
      }
      seen.add(r.ruleType);
    }
    next();
   });

  const ChaosRuleSet = mongoose.model('ChaosRuleSet', chaosRuleSetSchema);

  export default ChaosRuleSet;
