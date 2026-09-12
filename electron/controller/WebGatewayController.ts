import Logger from "../core/Logger";
import RemoteGatewayService from "../service/RemoteGatewayService";
import WebPublicationService from "../service/WebPublicationService";
import ResponseUtils from "../utils/ResponseUtils";
import BaseController from "./BaseController";

class WebGatewayController extends BaseController {
  constructor(
    private readonly gatewayService: RemoteGatewayService,
    private readonly publicationService: WebPublicationService
  ) {
    super();
  }

  getConfig(req: ControllerParam) {
    this.reply(
      req,
      Promise.resolve(this.gatewayService.getConfig()),
      "getConfig"
    );
  }

  saveConfig(req: ControllerParam) {
    this.reply(
      req,
      Promise.resolve().then(() => this.gatewayService.saveConfig(req.args)),
      "saveConfig"
    );
  }

  scanHostKey(req: ControllerParam) {
    this.reply(req, this.gatewayService.scanHostKey(), "scanHostKey");
  }

  trustHostKey(req: ControllerParam) {
    this.reply(req, this.gatewayService.trustHostKey(), "trustHostKey");
  }

  testConnection(req: ControllerParam) {
    this.reply(req, this.gatewayService.testConnection(), "testConnection");
  }

  preview(req: ControllerParam) {
    this.reply(
      req,
      this.publicationService.preview(req.args?.id, req.args?.domainPrefix),
      "preview"
    );
  }

  publish(req: ControllerParam) {
    this.reply(
      req,
      this.publicationService.publish(req.args?.id, req.args?.domainPrefix),
      "publish"
    );
  }

  check(req: ControllerParam) {
    this.reply(req, this.publicationService.check(req.args?.id), "check");
  }

  unpublish(req: ControllerParam) {
    this.reply(
      req,
      this.publicationService.unpublish(req.args?.id),
      "unpublish"
    );
  }

  removeProject(req: ControllerParam) {
    this.reply(
      req,
      this.publicationService.removeProject(req.args?.id),
      "removeProject"
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
        Logger.error(`WebGatewayController.${action}`, error);
        req.event.reply(req.channel, {
          bizCode: "B2000",
          data: null,
          message: error.message
        } satisfies ApiResponse<null>);
      });
  }
}

export default WebGatewayController;
