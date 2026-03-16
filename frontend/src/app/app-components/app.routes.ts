import { Routes } from '@angular/router';
import { Field } from '../components/field/field';
import { HomeComponent } from '../components/home.component/home.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'field', component: Field }
];
