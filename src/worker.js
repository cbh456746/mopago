import {DEFAULT_CATALOG,validateState} from './game.js';
import {validateModel,recommend} from './expert-agent.js';
import {DEFAULT_STAGE_WEIGHTS} from './stage-distributions.js';
self.onmessage=({data})=>{
  try {
    validateModel(data.model,DEFAULT_CATALOG,DEFAULT_STAGE_WEIGHTS);
    validateState(data.state,DEFAULT_CATALOG);
    self.postMessage({id:data.id,type:'result',result:recommend(
      data.state,DEFAULT_CATALOG,data.model,DEFAULT_STAGE_WEIGHTS,data.model.search
    )});
  }catch(error){self.postMessage({id:data.id,type:'error',message:error.message});}
};
