import mongoose, { mongo, set } from "mongoose";
import ChaosRuleSet, {RULE_TYPE} from "../../models/ChaosRule.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";

//deleteRule - single rule
//activate deactivate single rule
//add or update rules -> individual rule

//what we want to have is 
//activate deactive all rules at once on the project level
//activate deavtivate all rules at once on the endpoint level

function assertValidRuleType(ruleType){
    if(!RULE_TYPE.includes(ruleType)){
        throw new ApiError(400,`Invalid ruletype : ${ruleType}`);
    }
}

function assertValidProbability(probability){
    if(probability === undefined) return;
    if(typeof probability !== "number" || probability < 0 || probability > 1){
        throw new ApiError(400, "probability must be a number between 0 and 1");
    }
}

const upsertRuleService = async({
    projectId,
    endpointId = null,
    ruleType,
    probability ,
    config ,
    isEnabled ,
}) => {
    const now = new Date();
    //'rules.$[r].probability': probability --> use to update specific elememt inside the array
    //positional operator

    //try updating in place first
    const setFields = {
        "rule.$[r].updatedAt" : now,
    };
    
    if(probability !== undefined){
        setFields["rules.$[r].probability"] = probability;
    }

    if(config !== undefined){
        setFields["rule.$[r].config"] = config;
    }

    if(isEnabled !== isEnabled){
        setFields["rule.$[r].isEnabled"] = isEnabled;
    }

    const updated = await ChaosRuleSet.findOneAndUpdate(
        {projectId, endpointId, 'rules.ruleType': ruleType},
        {
            $set: setFields,
        },
        {arrayFilters : [
            {'r.ruleType' : ruleType}
        ], 
        new : true
        }
    );

    if(updated) return updated;

    //rule doesn;t exist yet in this scope - push it
    return ChaosRuleSet.findOneAndUpdate(
        {projectId, endpointId},
        {
            $setOnInsert : {projectId, endpointId},
            $push : {
                rules: {
                    _id: new mongoose.Types.ObjectId(),
                    ruleType,
                    probability,
                    config,
                    isEnabled,
                    createdAt : now,
                    updatedAt: now,
                },
            },
        },
        {upsert : true, new : true}
    );
}

const createChaosService = async({
    projectId,
    endpointId = null,
    ruleType,
    probability = 1.0,
    config = {},
    isEnabled = true,
}) => {
    
    assertValidProbability(probability);
    assertValidRuleType(ruleType);

    const now = new Date();

    try{
        const updated = await ChaosRuleSet.findOneAndUpdate(
            {projectId, endpointId, "rules.ruleType" : {$ne : ruleType}},
            {
                $setOnInsert : {projectId, endpointId},
                $push : {
                    rules : {
                        _id : new mongoose.Types.ObjectId(),
                        ruleType,
                        probability,
                        config,
                        isEnabled,
                        createdAt : now,
                        updatedAt: now,
                    },
                },
            },
            {upsert : true, new : true}
        );

        return updated;
    }catch(error){
        if(error.code == 11000){
            throw new ApiError(409, `Rule "${ruleType}" already exists in the scope`)
        }
        throw error;
    }
}

const updateChaosService = async({
    projectId,
    endpointId = null,
    ruleType,
    probability,
    config,
    isEnabled,
}) => {
    assertValidProbability(probability);
    assertValidRuleType(ruleType);

    const setFields = {"rules.$[r].updatedAt" : new Date()};
    if(probability !== undefined) setFields["rules.$[r].probability"] = probability;
    if(config !== undefined) setFields["rules.$[r].config"] = config;
    if(isEnabled !== undefined) setFields["rules.$[r].isEnabled"] = isEnabled;

    const updated = await ChaosRuleSet.findOneAndUpdate(
        {projectId, endpointId, "rules.ruleType" : ruleType},
        {$set : setFields},
        {arrayFilters : [{"r.ruleType" : ruleType}], new : true}
    );

    if(!updated){
        throw new ApiError(404, `Rule "${ruleType}" not found in this scope`)
    }

    return updated;
}

const setEnabled = async({
    projectId,
    endpointId,
    ruleType,
    isEnabled
}) => {
    assertValidRuleType(ruleType);
    const updated = await ChaosRuleSet.findOneAndUpdate(
        {projectId, endpointId, "rules.ruleType" : ruleType},
        {$set : {"rules.$[r].isEnabled" : isEnabled, "rules.$[r].updatedAt" : new Date()}},
        {arrayFilters: [{"r.ruleType" : ruleType}] , new: true}
    );

    if(!updated){
        throw new ApiError(404, "ruletype not found in this scope");
    }

    return updated;
}

const activateChaosService = async({
    projectId, 
    endpointId = null,
    ruleType
}) => {
    return setEnabled({projectId, endpointId, ruleType, isEnabled: true});
}

const deactivateChaosService = async({

    projectId, 
    endpointId = null,
    ruleType
}) => {
    return setEnabled({projectId, endpointId, ruleType, isEnabled: false});
}

const deleteChaosService = async({projectId, endpointId = null, ruleType}) => {
    assertValidRuleType(ruleType);

    const updated = await ChaosRuleSet.findOneAndUpdate(
        {projectId, endpointId, "rules.ruleType" : ruleType},
        {$pull : {rules : {ruleType}}},
        {new : true}
    );

    if(!updated){
        throw new ApiError(404, "ruletype not found in this scope");
    }

    if(updated.rules && updated.rules.length === 0){
        await ChaosRuleSet.deleteOne({_id : updated._id});
    }

    return updated;
}

export {
    upsertRuleService,
    createChaosService,
    updateChaosService,
    activateChaosService,
    deactivateChaosService,
    deleteChaosService,
}

