import Logger from "../core/Logger";
import WebProjectService from "../service/WebProjectService";
import ResponseUtils from "../utils/ResponseUtils";
import BaseController from "./BaseController";

class WebProjectController extends BaseController {
  constructor(private readonly service: WebProjectService) {
    super();
  }

  list(req: ControllerParam) {
    this.reply(req, this.service.getProjects(false), "list");
  }

  scan(req: ControllerParam) {
    this.reply(req, this.service.scanProjects(), "scan");
  }

  update(req: ControllerParam) {
    this.reply(req, this.service.updateProject(req.args), "update");
  }

  start(req: ControllerParam) {
    this.reply(req, this.service.startProject(req.args?.id), "start");
  }

  stop(req: ControllerParam) {
    this.reply(req, this.service.stopProject(req.args?.id), "stop");
  }

  restart(req: ControllerParam) {
    this.reply(req, this.service.restartProject(req.args?.id), "restart");
  }

  getLog(req: ControllerParam) {
    this.reply(req, this.service.getProjectLog(req.args?.id), "getLog");
  }

  openDirectory(req: ControllerParam) {
    this.reply(
      req,
      this.service.openProjectDirectory(req.args?.id),
      "openDirectory"
    );
  }

  private reply(
    req: ControllerParam,
    operation: Promise<unknown>,
    action: string
  ): void {
    operation
      .then(data => req.event.reply(req.channel, ResponseUtils.success(data)))
      .catch((error: Error) => {
        Logger.error(`WebProjectController.${action}`, error);
        req.event.reply(req.channel, {
          bizCode: "B2000",
          data: null,
          message: error.message
        } satisfies ApiResponse<null>);
      });
  }
}

export default WebProjectController;
