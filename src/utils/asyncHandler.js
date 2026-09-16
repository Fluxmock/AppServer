const asyncHandler = (requestHandler) => {
    return async (req, res, next) => {
        try {
            await requestHandler(req, res, next);
        } catch (error) {
            next(error);
        }
    };
};

export default asyncHandler;

//wrapper for async express route handlers
//if an asyc controller throws an error automatically pass that error to ecpress's error 
//handlers middlerwares using next(err)
//no repeatative try catch, wrapper handles it