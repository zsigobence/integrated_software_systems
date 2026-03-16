import { BootstrapContext, bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app-components/app';
import { config } from './app/app-components/app.config.server';

const bootstrap = (context: BootstrapContext) =>
    bootstrapApplication(App, config, context);

export default bootstrap;
